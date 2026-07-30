/**
 * Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com) All Rights Reserved.
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import * as fs from "fs";
import * as path from "path";
import { commands } from "vscode";
import {
    AvailableNode,
    CodeData,
    DIRECTORY_MAP,
    FlowNode,
    NodeKind,
    ProjectStructureArtifactResponse,
    toAgentBaseName,
    toAgentCamelCase,
} from "@wso2/ballerina-core";
import { extension } from "../../BalExtensionContext";
import { StateMachine } from "../../stateMachine";
import { BiDiagramRpcManager } from "../../rpc-managers/bi-diagram/rpc-manager";
import { writeBallerinaFileDidOpen } from "../../utils/modification";
import { updateSourceCode } from "../../utils/source-utils";
import { CONFIGURE_DEFAULT_MODEL_COMMAND } from "../ai/constants";

/** Organization of the bundled AI module; anything else means a BYO-key provider. */
const BALLERINA_ORG = "ballerina";
/** Module the AI chat service is generated from. */
const AI_MODULE_NAME = "ai";
/** Shared listener every AI chat agent service in a package binds to. */
const AI_CHAT_AGENT_LISTENER = "chatAgentListener";
/** Shared variable name of the default (WSO2) model provider, reused across agents. */
const AI_WSO2_MODEL_PROVIDER = "wso2ModelProvider";
/** Suffix appended to the base name for the per-agent BYO-key model provider. */
const MODEL_VARIABLE_SUFFIX = "Model";
/** Suffix appended to the base name for the agent connection. */
const AGENT_VARIABLE_SUFFIX = "Agent";
/** Listener the AI chat service is exposed on. */
const DEFAULT_HTTP_LISTENER_EXPRESSION = "check http:getDefaultListener()";

/** Codedata of the default WSO2-hosted model provider (bundled `ballerina/ai`). */
const WSO2_MODEL_PROVIDER_CODEDATA: CodeData = {
    node: "MODEL_PROVIDER",
    org: "ballerina",
    module: "ai",
    packageName: "ai",
    symbol: "getDefaultModelProvider",
};

/** Codedata of the BYO-key OpenAI provider used when `ballerinax/ai` is in play. */
const OPENAI_PROVIDER_CODEDATA: CodeData = {
    node: "CLASS_INIT",
    org: "ballerinax",
    module: "ai",
    packageName: "ai",
    object: "OpenAiProvider",
    symbol: "init",
};

/** Codedata identifying the shared `ballerina/ai` listener model. */
const AI_LISTENER_CODEDATA = {
    orgName: "ballerina",
    packageName: "ai",
    moduleName: "ai",
    version: "1.0.0",
};

/**
 * Progress narration, worded to match the in-package `AIChatAgentWizard` stepper
 * so both entry points describe the same work identically.
 */
export const AI_CHAT_AGENT_PROGRESS = {
    modelProvider: "Creating the model provider for the AI chat agent",
    pullingModules: "Pulling the required modules. This may take a few moments.",
    agent: "Creating the AI chat agent",
    listener: "Configuring the service listener",
    service: "Setting up the AI chat service",
    finalizing: "Finalizing the agent setup",
} as const;

/**
 * How long the model-provider/agent phase may run before the narration switches to
 * "Pulling the required modules". Building the module dependency map can require a
 * fetch from Ballerina Central, and a silent multi-second wait reads as a hang.
 */
const PULLING_MODULES_MESSAGE_DELAY_MS = 3000;
/** Grace period after a source update before the module-pull flags are trusted. */
const MODULE_PULL_SETTLE_MS = 1000;
/** Poll interval while waiting for an in-flight module pull to finish. */
const MODULE_PULL_POLL_MS = 100;
/** Upper bound on the module-pull wait, so a lost notification cannot hang the flow. */
const MODULE_PULL_TIMEOUT_MS = 5 * 60 * 1000;

export interface CreateAiChatAgentParams {
    /** Root of the package the agent is generated into. */
    projectRoot: string;
    /** Display name the user entered (e.g. "Customer Support Assistant"). */
    agentName: string;
    /** Narrates each long-running step; see {@link AI_CHAT_AGENT_PROGRESS}. */
    onProgress?: (message: string) => void;
}

export interface CreateAiChatAgentResult {
    /** The generated AI chat service, when the language server reported a new one. */
    serviceArtifact?: ProjectStructureArtifactResponse;
}

/**
 * Creates a complete AI chat agent inside `projectRoot`: a model provider, the
 * agent connection, the shared chat listener and the AI chat service that binds
 * them together — the same multi-step orchestration the in-package
 * `AIChatAgentWizard` form performs, but driven from the extension host against an
 * EXPLICIT package root.
 *
 * That explicitness is the whole point: the Create Integration wizard generates a
 * first artifact for a package that is not (yet) the visualizer's active project,
 * so every language-server call here targets `projectRoot` directly instead of
 * `StateMachine.context().projectPath`. The service-designer RPC managers force
 * the latter, which is why the listener/service steps below talk to the language
 * client directly rather than going through them.
 *
 * Rejects when any step fails, leaving whatever was generated so far in place —
 * callers surface the failure and let the user finish from the Artifacts panel.
 */
export async function createAiChatAgent(params: CreateAiChatAgentParams): Promise<CreateAiChatAgentResult> {
    const { projectRoot, agentName, onProgress } = params;
    const trimmedName = agentName.trim();
    if (!trimmedName) {
        throw new Error("An agent name is required");
    }

    const baseName = toAgentBaseName(trimmedName);
    const servicePath = toAgentCamelCase(trimmedName);
    if (!baseName || !servicePath) {
        throw new Error(`"${agentName}" cannot be turned into a valid agent identifier`);
    }

    const langClient = StateMachine.langClient();
    const biDiagram = new BiDiagramRpcManager();
    const mainBalFile = path.join(projectRoot, "main.bal");
    await ensureBallerinaFileExists(mainBalFile);

    // Resolving the AI module's org is what decides between the bundled default
    // provider and a BYO-key one, so it gates every later step.
    const { orgName: aiModuleOrg } = await langClient.getAiModuleOrg({ projectPath: projectRoot });
    const usesDefaultModelProvider = aiModuleOrg === BALLERINA_ORG;

    onProgress?.(AI_CHAT_AGENT_PROGRESS.modelProvider);
    // The provider/agent templates are the calls that may fetch from Central; escalate
    // the narration if they are still running after a few seconds (see the constant).
    const stopPullingNotice = onProgress
        ? scheduleMessage(onProgress, AI_CHAT_AGENT_PROGRESS.pullingModules, PULLING_MODULES_MESSAGE_DELAY_MS)
        : () => { };

    try {
        const modelVariableName = usesDefaultModelProvider
            ? AI_WSO2_MODEL_PROVIDER
            : `${baseName}${MODEL_VARIABLE_SUFFIX}`;

        // The default provider is shared package-wide, so reuse the existing
        // declaration when one is already there; a BYO-key provider is per-agent.
        const needsModelProvider = usesDefaultModelProvider
            ? !(await hasModelProvider(biDiagram, projectRoot, AI_WSO2_MODEL_PROVIDER))
            : true;

        if (needsModelProvider) {
            const modelTemplate = await fetchNodeTemplate(
                biDiagram,
                projectRoot,
                usesDefaultModelProvider ? WSO2_MODEL_PROVIDER_CODEDATA : OPENAI_PROVIDER_CODEDATA,
                "model provider"
            );
            modelTemplate.properties.variable.value = modelVariableName;
            await generateNodeSource(biDiagram, projectRoot, modelTemplate, "model provider");
        }

        onProgress?.(AI_CHAT_AGENT_PROGRESS.agent);

        const agentNode = await findAgentNode(biDiagram, projectRoot, aiModuleOrg);
        const agentTemplate = await fetchNodeTemplate(biDiagram, projectRoot, agentNode.codedata, "agent");
        agentTemplate.properties.systemPrompt.value = `{role: string \`${trimmedName}\`, instructions: string \`\`}`;
        agentTemplate.properties.model.value = modelVariableName;
        agentTemplate.properties.tools.value = "[]";
        agentTemplate.properties.variable.value = `${baseName}${AGENT_VARIABLE_SUFFIX}`;
        await generateNodeSource(biDiagram, projectRoot, agentTemplate, "agent");
    } finally {
        stopPullingNotice();
    }

    onProgress?.(AI_CHAT_AGENT_PROGRESS.listener);
    await ensureChatAgentListener(projectRoot, mainBalFile);

    onProgress?.(AI_CHAT_AGENT_PROGRESS.service);
    const serviceArtifact = await generateChatService(mainBalFile, aiModuleOrg, servicePath, baseName);

    if (usesDefaultModelProvider) {
        onProgress?.(AI_CHAT_AGENT_PROGRESS.finalizing);
        // Writes the default provider's credentials into the project's Config.toml,
        // prompting the user to sign in when they are not authenticated yet.
        await commands.executeCommand(CONFIGURE_DEFAULT_MODEL_COMMAND, "model");
    }

    return { serviceArtifact };
}

/** Creates `main.bal` (and notifies the language server) when it is not there yet. */
async function ensureBallerinaFileExists(filePath: string): Promise<void> {
    if (!fs.existsSync(filePath)) {
        await writeBallerinaFileDidOpen(filePath, "\n");
    }
}

/** True when a module-level model provider with `variableName` already exists. */
async function hasModelProvider(
    biDiagram: BiDiagramRpcManager,
    projectRoot: string,
    variableName: string
): Promise<boolean> {
    const existing = await biDiagram.searchNodes({
        filePath: projectRoot,
        queryMap: { kind: "MODEL_PROVIDER" as NodeKind },
    });
    return !!existing?.output?.some((node) => String(node.properties?.variable?.value) === variableName);
}

/** Resolves the agent node the installed AI module offers, or throws if there is none. */
async function findAgentNode(
    biDiagram: BiDiagramRpcManager,
    projectRoot: string,
    aiModuleOrg: string
): Promise<AvailableNode> {
    const response = await biDiagram.search({
        filePath: projectRoot,
        queryMap: { orgName: aiModuleOrg },
        searchKind: "AGENT",
    });
    const agentNode = response?.categories?.[0]?.items?.[0] as AvailableNode | undefined;
    if (!agentNode?.codedata) {
        throw new Error(`No agent node is available in the "${aiModuleOrg}/ai" module`);
    }
    return agentNode;
}

/** Fetches a node template against `projectRoot`, failing loudly instead of returning undefined. */
async function fetchNodeTemplate(
    biDiagram: BiDiagramRpcManager,
    projectRoot: string,
    codedata: CodeData,
    label: string
): Promise<FlowNode> {
    const response = await biDiagram.getNodeTemplate({
        position: { line: 0, offset: 0 },
        filePath: projectRoot,
        id: codedata,
        projectPath: projectRoot,
    });
    if (!response?.flowNode?.properties) {
        throw new Error(`The language server did not return a ${label} template`);
    }
    return response.flowNode;
}

/** Writes a configured flow node into the package, surfacing language-server errors. */
async function generateNodeSource(
    biDiagram: BiDiagramRpcManager,
    projectRoot: string,
    flowNode: FlowNode,
    label: string
): Promise<void> {
    const result = await biDiagram.getSourceCode({ filePath: projectRoot, flowNode });
    if (result.error) {
        throw new Error(`Failed to create the ${label}: ${result.error}`);
    }
}

/**
 * Adds the shared AI chat listener to the package unless it is already declared.
 *
 * Goes to the language client directly (rather than `ServiceDesignerRpcManager`)
 * because that manager rewrites `filePath` to the ACTIVE project's `main.bal`,
 * which is not the package being created here.
 */
async function ensureChatAgentListener(projectRoot: string, mainBalFile: string): Promise<void> {
    const langClient = StateMachine.langClient();

    if (await hasChatAgentListener(projectRoot)) {
        return;
    }

    const { listener } = await langClient.getListenerModel({
        codedata: AI_LISTENER_CODEDATA,
        filePath: mainBalFile,
    });
    listener.properties["variableNameKey"].value = AI_CHAT_AGENT_LISTENER;
    listener.properties["listenOn"].value = DEFAULT_HTTP_LISTENER_EXPRESSION;

    const { textEdits } = await langClient.addListenerSourceCode({ filePath: mainBalFile, listener });
    await updateSourceCode({
        textEdits,
        resolveMissingDependencies: true,
        artifactData: { artifactType: DIRECTORY_MAP.LISTENER },
        description: `${listener.name} Creation`,
    });
    await waitForPendingModulePull();
}

/**
 * True when the package already declares the shared chat listener. A design model
 * that cannot be read (e.g. a package the language server has not indexed yet) is
 * treated as "no listener", matching the in-package form's optional-chained check.
 */
async function hasChatAgentListener(projectRoot: string): Promise<boolean> {
    try {
        const { designModel } = await StateMachine.langClient().getDesignModel({ projectPath: projectRoot });
        return !!designModel?.listeners?.some(
            (listener) => listener.symbol?.toLowerCase() === AI_CHAT_AGENT_LISTENER.toLowerCase()
        );
    } catch (error) {
        console.warn("[AIChatAgent] Could not read the design model; assuming no chat listener exists.", error);
        return false;
    }
}

/**
 * Generates the AI chat service bound to the shared listener and the agent, and
 * returns the artifact the language server reported as new (undefined when it
 * reported none, which callers treat as "nothing to navigate to").
 */
async function generateChatService(
    mainBalFile: string,
    aiModuleOrg: string,
    servicePath: string,
    agentBaseName: string
): Promise<ProjectStructureArtifactResponse | undefined> {
    const langClient = StateMachine.langClient();

    const { service } = await langClient.getServiceModel({
        filePath: mainBalFile,
        moduleName: AI_MODULE_NAME,
        listenerName: AI_CHAT_AGENT_LISTENER,
        orgName: aiModuleOrg,
    });

    service.properties["listener"].editable = true;
    service.properties["listener"].items = [AI_CHAT_AGENT_LISTENER];
    service.properties["listener"].value = AI_CHAT_AGENT_LISTENER;
    service.properties["basePath"].value = `/${servicePath}`;
    service.properties["agentName"].value = agentBaseName;

    const { textEdits } = await langClient.addServiceSourceCode({ filePath: mainBalFile, service });
    const artifacts = await updateSourceCode({
        textEdits,
        artifactData: { artifactType: DIRECTORY_MAP.SERVICE },
        description: `${service.name} Creation`,
    });
    return artifacts.find((artifact) => artifact.isNew);
}

/**
 * Waits out a module pull kicked off by the preceding source update, so the next
 * language-server request is not issued against a half-resolved dependency graph.
 * Bounded, because the "resolved" flag is driven by a notification that may never
 * arrive.
 */
async function waitForPendingModulePull(): Promise<void> {
    await delay(MODULE_PULL_SETTLE_MS);
    if (!extension.hasPullModuleNotification) {
        return;
    }
    const deadline = Date.now() + MODULE_PULL_TIMEOUT_MS;
    while (!extension.hasPullModuleResolved) {
        if (Date.now() > deadline) {
            console.warn("[AIChatAgent] Timed out waiting for the module pull to finish; continuing.");
            return;
        }
        await delay(MODULE_PULL_POLL_MS);
    }
}

/** Reports `message` after `delayMs` unless the returned canceller runs first. */
function scheduleMessage(report: (message: string) => void, message: string, delayMs: number): () => void {
    const handle = setTimeout(() => report(message), delayMs);
    return () => clearTimeout(handle);
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
