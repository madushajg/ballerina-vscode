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

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Context } from "@wso2/ballerina-rpc-client";
import { ProjectStructureResponse } from "@wso2/ballerina-core";
import { WorkspaceOverview } from "./index";
import { createMockRpcClient } from "../../../test/test-utils";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const emptyWorkspace: ProjectStructureResponse = {
    workspaceName: "my-project",
    workspaceTitle: "My Project",
    workspacePath: "/workspace",
    projects: [],
};

const workspaceWithIntegration: ProjectStructureResponse = {
    workspaceName: "my-project",
    workspaceTitle: "My Project",
    workspacePath: "/workspace",
    projects: [
        { projectPath: "/workspace/integration1", projectName: "integration1", isLibrary: false, directoryMap: {} as any },
    ],
};

// ── Test helpers ──────────────────────────────────────────────────────────────

function createWorkspaceRpcClient(projectStructure = emptyWorkspace) {
    const base = createMockRpcClient();
    const biDiagram = {
        ...base.__mocks.biDiagram,
        getProjectStructure: jest.fn().mockResolvedValue(projectStructure),
        getWorkspaceDevantMetadata: jest.fn().mockResolvedValue({ projectsMetadata: [] }),
        handleReadmeContent: jest.fn().mockResolvedValue({ content: "" }),
        getReadmeContent: jest.fn().mockResolvedValue({ content: "" }),
    };
    const common = {
        executeCommand: jest.fn().mockResolvedValue(undefined),
    };
    const aiPanel = {
        showSignInAlert: jest.fn().mockResolvedValue(false),
        markAlertShown: jest.fn().mockResolvedValue(undefined),
    };
    const icp = {
        isIcpEnabled: jest.fn().mockResolvedValue({ enabled: false }),
    };
    return {
        ...base,
        getBIDiagramRpcClient: () => biDiagram,
        getCommonRpcClient: () => common,
        getAiPanelRpcClient: () => aiPanel,
        getICPRpcClient: () => icp,
        onProjectContentUpdated: jest.fn().mockReturnValue(() => {}),
        __mocks: { biDiagram, common, aiPanel, icp },
    } as any;
}

function renderWorkspaceOverview(isInDevant = false, rpcClient = createWorkspaceRpcClient()) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const result = render(
        <QueryClientProvider client={queryClient}>
            <Context.Provider value={{ rpcClient }}>
                <WorkspaceOverview isInDevant={isInDevant} />
            </Context.Provider>
        </QueryClientProvider>
    );
    return { ...result, rpcClient };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("WorkspaceOverview", () => {
    it("shows empty state when project has no integrations", async () => {
        renderWorkspaceOverview(false, createWorkspaceRpcClient(emptyWorkspace));
        await screen.findByText("Your project is empty");
        expect(screen.getByText(/Start by adding integrations/)).toBeInTheDocument();
    });

    it("shows Add and Generate with AI buttons when project has integrations", async () => {
        renderWorkspaceOverview(false, createWorkspaceRpcClient(workspaceWithIntegration));
        await screen.findByText(/^Add$/);
        expect(screen.getByText(/Generate with AI/)).toBeInTheDocument();
    });

    it("calls executeCommand when Add Integration or Library is clicked", async () => {
        const rpcClient = createWorkspaceRpcClient(emptyWorkspace);
        renderWorkspaceOverview(false, rpcClient);
        const addButton = await screen.findByText(/Add Integration or Library/);
        fireEvent.click(addButton);
        expect(rpcClient.__mocks.common.executeCommand).toHaveBeenCalled();
    });
});
