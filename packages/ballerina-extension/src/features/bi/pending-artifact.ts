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
import { ProgressLocation, window } from "vscode";
import {
    EVENT_TYPE,
    INTEGRATION_ARTIFACT_LABELS,
    isPathInside,
    isSamePath,
    MACHINE_VIEW,
    PendingIntegrationArtifactPayload,
} from "@wso2/ballerina-core";
import { openView, StateMachine } from "../../stateMachine";
import { ServiceDesignerRpcManager } from "../../rpc-managers/service-designer/rpc-manager";
import { BiDiagramRpcManager } from "../../rpc-managers/bi-diagram/rpc-manager";
import { createAiChatAgent } from "./ai-chat-agent";
import {
    clearPendingIntegrationPointer,
    isPendingPointerFresh,
    PendingIntegrationArtifactPointer,
    readPendingIntegrationPointer,
    writePendingIntegrationPointer,
} from "./startup-progress";

/** Payload file location inside the scaffolded project (target/ is gitignored by the scaffold). */
const PENDING_ARTIFACT_RELATIVE_PATH = path.join("target", ".wizard-pending-artifact.json");

/** Human-readable labels for progress and error messages, per artifact kind. */
const ARTIFACT_KIND_LABELS = INTEGRATION_ARTIFACT_LABELS;

function pendingArtifactFilePath(projectRoot: string): string {
    return path.join(projectRoot, PENDING_ARTIFACT_RELATIVE_PATH);
}

/**
 * Where the window should land once the startup generation finishes, and whether
 * landings are currently being deferred.
 *
 * The startup run happens in the `finalizePendingIntegration` machine state, which
 * sits BEFORE `extensionReady` precisely so the visualizer keeps showing the
 * "Creating <name>" screen for the whole create instead of flashing an empty
 * package overview first. `OPEN_VIEW` is only handled from `extensionReady`
 * onwards, so navigating from inside that state would be silently dropped —
 * hence the landing is recorded here and replayed by
 * {@link runPendingIntegrationLanding} once the machine is ready to accept it.
 *
 * `generateArtifactInPlace` does not defer: it runs in an already-ready window.
 */
let deferLandings = false;
let deferredLanding: (() => void) | undefined;

/** Navigates now, or records the landing when the startup run is deferring. */
function land(navigate: () => void): void {
    if (deferLandings) {
        deferredLanding = navigate;
        return;
    }
    navigate();
}

/**
 * Performs the landing recorded by the startup run. Called as the machine enters
 * `extensionReady`, which is the earliest point an `OPEN_VIEW` is accepted.
 * A no-op when there was no pending create.
 *
 * Also stops deferring, so a generation still running (startup gave up waiting on
 * it — see the timeout in `finalizePendingIntegration`) navigates immediately when
 * it eventually finishes, rather than recording a landing nothing will replay.
 */
export function runPendingIntegrationLanding(): void {
    deferLandings = false;
    const landing = deferredLanding;
    deferredLanding = undefined;
    landing?.();
}

/**
 * Records the create the wizard just performed so the reloaded window can finish
 * it: generate the configured first artifact (when there is one) and land on the
 * new integration. Call this right before `openInVSCode(projectRoot)`.
 *
 * The pointer is written even for an empty integration (no `payload`): it is also
 * what lets the reloading window narrate "Creating <name>" on its startup screen
 * and navigate to the result, instead of coming up on a bare loading screen.
 */
export async function schedulePendingIntegration(
    projectRoot: string,
    integrationName: string,
    payload?: PendingIntegrationArtifactPayload
): Promise<void> {
    if (payload) {
        const payloadFile = pendingArtifactFilePath(projectRoot);
        fs.mkdirSync(path.dirname(payloadFile), { recursive: true });
        fs.writeFileSync(payloadFile, JSON.stringify(payload), "utf8");
    }

    await writePendingIntegrationPointer({
        projectRoot,
        timestamp: Date.now(),
        integrationName,
        artifactKind: payload?.kind,
    });
    console.log(
        `[IntegrationWizard] Scheduled pending ${payload?.kind ?? "empty"} integration for project: ${projectRoot}`
    );
}

/**
 * Finishes a Create Integration wizard submit that spanned the last folder
 * reload: generates the configured first artifact (when there was one) and lands
 * on the new integration.
 *
 * Consume-immediately semantics: the globalState pointer and the payload file
 * are both cleared BEFORE any generation runs, so a failure can never loop.
 * Safe to call on every activation — a no-op when there is no pending entry.
 * Never throws.
 *
 * No progress notification is raised for the artifact kinds that generate in one
 * language-server call: while those run the visualizer is still showing the
 * "Creating <name>" startup screen carried over from the wizard, so a toast on top
 * of it would narrate the same wait twice. The AI chat agent is the exception —
 * see {@link runGeneration}.
 */
export async function checkAndRunPendingArtifact(): Promise<void> {
    deferLandings = true;
    try {
        const stored = readPendingIntegrationPointer();
        if (!stored) {
            return;
        }

        // Consume the pointer immediately to avoid re-running on later activations.
        await clearPendingIntegrationPointer();

        const payload = consumePendingArtifactPayload(stored.projectRoot);

        // Discard stale entries (e.g. the user opened an unrelated workspace later).
        if (!isPendingPointerFresh(stored)) {
            const age = Date.now() - stored.timestamp;
            console.log(`[IntegrationWizard] Discarding stale pending artifact (age: ${Math.round(age / 1000)}s)`);
            return;
        }

        // The pending entry only applies to the project it was scheduled for.
        // It was created either as a standalone package (opened directly, so it is
        // the context's projectPath) or inside an existing Ballerina workspace (the
        // workspace root is opened and projectPath is undefined, so match by the
        // package living under the opened workspace).
        const ctx = StateMachine.context();
        const opensStoredPackage = isSamePath(stored.projectRoot, ctx.projectPath);
        const insideOpenWorkspace = !!ctx.workspacePath && isPathInside(ctx.workspacePath, stored.projectRoot);
        if (!opensStoredPackage && !insideOpenWorkspace) {
            console.log(
                `[IntegrationWizard] Pending artifact project (${stored.projectRoot}) does not match ` +
                `the opened project (projectPath=${ctx.projectPath}, workspacePath=${ctx.workspacePath}) — skipping.`
            );
            return;
        }

        // An empty integration has no payload: there is nothing to generate, only
        // the landing view below to open.
        if (!payload) {
            ensureLandedOnNewIntegration(stored, opensStoredPackage);
            return;
        }

        const label = ARTIFACT_KIND_LABELS[payload.kind];
        if (!label || payload.version !== 1) {
            console.error(`[IntegrationWizard] Unsupported pending artifact payload:`, payload);
            ensureLandedOnNewIntegration(stored, opensStoredPackage);
            return;
        }

        const addedIntoWorkspace = insideOpenWorkspace && !opensStoredPackage;
        console.log(
            `[IntegrationWizard] Pending artifact: kind=${payload.kind}, projectRoot=${stored.projectRoot}, ` +
            `opensStoredPackage=${opensStoredPackage}, insideOpenWorkspace=${insideOpenWorkspace}, ` +
            `addedIntoWorkspace=${addedIntoWorkspace}`
        );
        let navigated = false;
        try {
            // Standalone: land on the package overview (the package's home). Added
            // into a workspace: don't drill into the package — the landing below
            // puts the window on the workspace overview instead.
            navigated = await runGeneration(payload, stored.projectRoot, opensStoredPackage, label);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`[IntegrationWizard] Failed to generate pending ${payload.kind} artifact:`, error);
            window.showErrorMessage(
                `Couldn't create the ${label}: ${message}. ` +
                `Your integration was created; you can add the artifact from the Artifacts panel.`
            );
        }
        // Generation picks its own landing when it succeeds (the generated artifact,
        // or the new package's overview). When it did not — an artifact added into a
        // workspace, or a failed generation — fall back, so the window is never left
        // sitting on the startup screen that was narrating the create.
        if (!navigated) {
            ensureLandedOnNewIntegration(stored, opensStoredPackage);
        }
    } catch (error) {
        console.error("[IntegrationWizard] Unexpected error while checking pending artifact:", error);
    } finally {
        deferLandings = false;
    }
}

/**
 * Guarantees the window ends up on a real view after a wizard create, instead of
 * sitting on the startup progress screen. Used only when generation did not pick a
 * landing itself: an empty integration with nothing to generate, a package added
 * into a workspace, or a failed generation.
 */
function ensureLandedOnNewIntegration(
    pointer: PendingIntegrationArtifactPointer,
    opensStoredPackage: boolean
): void {
    if (opensStoredPackage) {
        openPackageOverview(pointer.projectRoot);
        return;
    }
    land(() => openView(EVENT_TYPE.OPEN_VIEW, { view: MACHINE_VIEW.WorkspaceOverview }));
}

/**
 * Reads and immediately deletes the payload file (consume-before-generate).
 * Returns undefined when the file is missing (the normal case for an empty
 * integration, which schedules a pointer but no payload) or unreadable.
 */
function consumePendingArtifactPayload(projectRoot: string): PendingIntegrationArtifactPayload | undefined {
    const payloadFile = pendingArtifactFilePath(projectRoot);
    if (!fs.existsSync(payloadFile)) {
        return undefined;
    }
    let raw: string;
    try {
        raw = fs.readFileSync(payloadFile, "utf8");
    } catch (error) {
        console.warn(`[IntegrationWizard] Could not read pending artifact payload at: ${payloadFile}`, error);
        return undefined;
    }
    try {
        fs.rmSync(payloadFile, { force: true });
    } catch (error) {
        console.warn(`[IntegrationWizard] Failed to delete pending artifact payload: ${payloadFile}`, error);
    }
    try {
        return JSON.parse(raw) as PendingIntegrationArtifactPayload;
    } catch (error) {
        console.error(`[IntegrationWizard] Pending artifact payload is not valid JSON: ${payloadFile}`, error);
        return undefined;
    }
}

/**
 * Generates a configured first artifact for a package that was just added into a
 * workspace that is ALREADY open in this window (no folder switch, no reload —
 * see `createIntegration` in integration-wizard.ts). Unlike `checkAndRunPendingArtifact`,
 * this runs entirely in the current session: there is no globalState pointer and no
 * reliance on the `extensionReady` transition.
 */
export async function generateArtifactInPlace(
    packageRoot: string,
    payload: PendingIntegrationArtifactPayload,
    landOnPackageOverview = false
): Promise<void> {
    const label = ARTIFACT_KIND_LABELS[payload.kind];
    if (!label || payload.version !== 1) {
        console.error(`[IntegrationWizard] Unsupported artifact payload for in-place generation:`, payload);
        return;
    }

    try {
        const navigated = await window.withProgress(
            { location: ProgressLocation.Notification, title: `Setting up your ${label}...` },
            (progress) =>
                generatePendingArtifact(payload, packageRoot, landOnPackageOverview, (message) =>
                    progress.report({ message })
                )
        );
        // A non-silent refresh ends on the workspace overview (see UPDATE_PROJECT_INFO
        // in stateMachine.ts) — right for the add-into-open-workspace path, but it
        // would clobber the view just navigated to above, showing the workspace
        // overview and then jumping. Refresh silently whenever generation navigated.
        StateMachine.refreshProjectInfo({ silent: navigated });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[IntegrationWizard] Failed to generate ${payload.kind} artifact in place:`, error);
        window.showErrorMessage(
            `Couldn't create the ${label}: ${message}. ` +
            `Your integration was created; you can add the artifact from the Artifacts panel.`
        );
    }
}

/**
 * Runs {@link generatePendingArtifact}, wrapped in a progress notification for the
 * kinds whose generation is long enough to need one.
 *
 * SERVICE / AUTOMATION / WORKFLOW generate in a single language-server call while
 * the visualizer still shows the "Creating <name>" startup screen, so they need no
 * toast. The AI chat agent is a multi-step orchestration — model provider, agent,
 * listener, service, plus the module pulls in between — and the step-by-step
 * notification is the same feedback the in-package "add an agent" flow gives.
 */
async function runGeneration(
    payload: PendingIntegrationArtifactPayload,
    projectRoot: string,
    landOnPackageOverview: boolean,
    label: string
): Promise<boolean> {
    if (payload.kind !== "AI_CHAT_AGENT") {
        return generatePendingArtifact(payload, projectRoot, landOnPackageOverview);
    }
    return window.withProgress(
        { location: ProgressLocation.Notification, title: `Setting up your ${label}...` },
        (progress) =>
            generatePendingArtifact(payload, projectRoot, landOnPackageOverview, (message) =>
                progress.report({ message })
            )
    );
}

/**
 * Runs the kind-specific generation and navigates to the produced artifact. All
 * files are targeted inside `projectRoot` — the newly created package — which is
 * the context's projectPath for a standalone package and a child package path
 * when added into an existing workspace (where the context has no projectPath).
 *
 * `landOnPackageOverview` controls the final navigation: true for a standalone
 * package (land on its overview); false when added into a workspace, so the
 * window stays on the project (workspace) overview it opened on rather than
 * auto-switching into the new package.
 *
 * Returns whether it navigated, so callers know not to clobber the view with a
 * subsequent project-info refresh.
 */
async function generatePendingArtifact(
    payload: PendingIntegrationArtifactPayload,
    projectRoot: string,
    landOnPackageOverview: boolean,
    onProgress?: (message: string) => void
): Promise<boolean> {
    switch (payload.kind) {
        case "SERVICE": {
            if (!payload.serviceInitModel) {
                throw new Error("The service configuration is missing");
            }
            // Target the new package explicitly (`<projectRoot>/main.bal`) so it works
            // both standalone and when the package lives inside an opened workspace.
            await new ServiceDesignerRpcManager().createServiceAndListener({
                filePath: "",
                projectPath: projectRoot,
                serviceInitModel: payload.serviceInitModel,
            });
            if (landOnPackageOverview) {
                openPackageOverview(projectRoot);
            }
            return landOnPackageOverview;
        }
        case "AUTOMATION":
        case "WORKFLOW": {
            if (!payload.flowNode) {
                throw new Error("The function configuration is missing");
            }
            // Same default file the FunctionForm targets (MainPanel's getDefaultFunctionsFile).
            const filePath = path.join(projectRoot, "functions.bal");
            await new BiDiagramRpcManager().getSourceCode({
                filePath,
                flowNode: payload.flowNode,
                isFunctionNodeUpdate: true,
            });
            if (landOnPackageOverview) {
                openPackageOverview(projectRoot);
            }
            return landOnPackageOverview;
        }
        case "AI_CHAT_AGENT": {
            const agentName = payload.aiAgent?.name?.trim();
            if (!agentName) {
                throw new Error("The AI chat agent configuration is missing");
            }
            // Generated here, in the extension host, against `projectRoot` — the same
            // orchestration the in-package AI Chat Agent form runs. Earlier this branch
            // only opened that form pre-filled and relied on the user pressing Create
            // again, which is why the wizard produced an empty integration.
            const { serviceArtifact } = await createAiChatAgent({ projectRoot, agentName, onProgress });
            if (serviceArtifact) {
                // Land on the generated agent, matching where the in-package flow ends.
                land(() =>
                    openView(EVENT_TYPE.OPEN_VIEW, {
                        documentUri: serviceArtifact.path,
                        position: serviceArtifact.position,
                    })
                );
                return true;
            }
            if (landOnPackageOverview) {
                openPackageOverview(projectRoot);
            }
            return landOnPackageOverview;
        }
        default:
            throw new Error(`Unsupported artifact kind: ${(payload as PendingIntegrationArtifactPayload).kind}`);
    }
}

/**
 * Lands on the new package's overview after the first artifact is created, rather
 * than drilling into the artifact's own designer. The overview lists the new
 * artifact and is the expected place to land after creating an integration. The
 * package root is passed as `projectPath` so it resolves correctly in a workspace
 * (where the context has no active `projectPath`).
 */
function openPackageOverview(projectRoot: string): void {
    land(() => openView(EVENT_TYPE.OPEN_VIEW, { view: MACHINE_VIEW.PackageOverview, projectPath: projectRoot }));
}
