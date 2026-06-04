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
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Context } from "@wso2/ballerina-rpc-client";
import { ProjectStructureResponse, DIRECTORY_MAP, ProjectDirectoryMap } from "@wso2/ballerina-core";
import { WorkspaceOverview } from "./index";
import { createMockRpcClient } from "../../../test/test-utils";
import { buildSnapshot } from "../../../test/snapshot-utils";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_WORKSPACE = {
    workspaceName: "my-project",
    workspaceTitle: "My Project",
    workspacePath: "/workspace",
};

/** A directoryMap with all keys present and empty by default. */
function emptyDirectoryMap(): ProjectDirectoryMap {
    return {
        [DIRECTORY_MAP.SERVICE]: [],
        [DIRECTORY_MAP.AUTOMATION]: [],
        [DIRECTORY_MAP.LISTENER]: [],
        [DIRECTORY_MAP.FUNCTION]: [],
        [DIRECTORY_MAP.CONNECTION]: [],
        [DIRECTORY_MAP.TYPE]: [],
        [DIRECTORY_MAP.CONFIGURABLE]: [],
        [DIRECTORY_MAP.DATA_MAPPER]: [],
        [DIRECTORY_MAP.NP_FUNCTION]: [],
        [DIRECTORY_MAP.AGENTS]: [],
        [DIRECTORY_MAP.LOCAL_CONNECTORS]: [],
    };
}

const emptyWorkspace: ProjectStructureResponse = {
    ...BASE_WORKSPACE,
    projects: [],
};

const workspaceWithIntegration: ProjectStructureResponse = {
    ...BASE_WORKSPACE,
    projects: [
        {
            projectName: "order-service",
            projectTitle: "Order Service",
            projectPath: "/workspace/order-service",
            isLibrary: false,
            directoryMap: {
                ...emptyDirectoryMap(),
                [DIRECTORY_MAP.SERVICE]: [
                    { id: "svc1", name: "OrderService", path: "/workspace/order-service/service.bal", type: "HTTP" },
                ],
            },
        },
    ],
};

const workspaceWithIntegrationAndLibrary: ProjectStructureResponse = {
    ...BASE_WORKSPACE,
    projects: [
        {
            projectName: "order-service",
            projectTitle: "Order Service",
            projectPath: "/workspace/order-service",
            isLibrary: false,
            directoryMap: {
                ...emptyDirectoryMap(),
                [DIRECTORY_MAP.SERVICE]: [
                    { id: "svc1", name: "OrderService", path: "/workspace/order-service/service.bal", type: "HTTP" },
                ],
            },
        },
        {
            projectName: "utils-lib",
            projectTitle: "Utils Library",
            projectPath: "/workspace/utils-lib",
            isLibrary: true,
            directoryMap: emptyDirectoryMap(),
        },
    ],
};

// ── Test helpers ──────────────────────────────────────────────────────────────

function createWorkspaceRpcClient(projectStructure: ProjectStructureResponse) {
    const base = createMockRpcClient();
    const biDiagram = {
        ...base.__mocks.biDiagram,
        getProjectStructure: jest.fn().mockResolvedValue(projectStructure),
        getWorkspaceDevantMetadata: jest.fn().mockResolvedValue({ projectsMetadata: [] }),
        handleReadmeContent: jest.fn().mockResolvedValue({ content: "" }),
        getReadmeContent: jest.fn().mockResolvedValue({ content: "" }),
    };
    return {
        ...base,
        getBIDiagramRpcClient: () => biDiagram,
        getCommonRpcClient: () => ({ executeCommand: jest.fn().mockResolvedValue(undefined) }),
        getAiPanelRpcClient: () => ({
            showSignInAlert: jest.fn().mockResolvedValue(false),
            markAlertShown: jest.fn().mockResolvedValue(undefined),
        }),
        getICPRpcClient: () => ({ isIcpEnabled: jest.fn().mockResolvedValue({ enabled: false }) }),
        onProjectContentUpdated: jest.fn().mockReturnValue(() => {}),
    } as any;
}

async function renderAndSnapshot(projectStructure: ProjectStructureResponse): Promise<string> {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const rpcClient = createWorkspaceRpcClient(projectStructure);
    const { container } = render(
        <QueryClientProvider client={queryClient}>
            <Context.Provider value={{ rpcClient }}>
                <WorkspaceOverview isInDevant={false} />
            </Context.Provider>
        </QueryClientProvider>
    );
    // Wait for async data to load before snapshotting.
    await screen.findByText("Integrations & Libraries");
    return buildSnapshot(container as HTMLElement);
}

// ── Snapshot tests ────────────────────────────────────────────────────────────

describe("WorkspaceOverview snapshots", () => {
    it("renders empty project correctly", async () => {
        const snapshot = await renderAndSnapshot(emptyWorkspace);
        expect(snapshot).toMatchSnapshot("empty-project");
    });

    it("renders project with single integration correctly", async () => {
        const snapshot = await renderAndSnapshot(workspaceWithIntegration);
        expect(snapshot).toMatchSnapshot("single-integration");
    });

    it("renders project with integration and library correctly", async () => {
        const snapshot = await renderAndSnapshot(workspaceWithIntegrationAndLibrary);
        expect(snapshot).toMatchSnapshot("integration-and-library");
    });
});
