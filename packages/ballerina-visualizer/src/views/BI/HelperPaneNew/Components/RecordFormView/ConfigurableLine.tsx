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
import styled from "@emotion/styled";
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react";
import { Codicon, Icon, ThemeColors, Tooltip } from "@wso2/ui-toolkit";
import { isValidConfigurableName } from "./configurables";

export const CONFIGURABLE_HELP =
    "Saves the value as a configurable, outside your code. It can be set again when you deploy.";

const INVALID_NAME = "Use letters, digits and _, and don't start with a digit.";

const Line = styled.div({
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "6px",
    minHeight: "22px",
    fontSize: "12px",
    lineHeight: "18px",
    color: "var(--vscode-foreground)",
});

const Toggle = styled("label", { shouldForwardProp: (prop) => prop !== "on" })<{ on: boolean }>(({ on }: { on: boolean }) => ({
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    cursor: "pointer",
    color: on ? "var(--vscode-foreground)" : ThemeColors.ON_SURFACE_VARIANT,
}));

const Name = styled.span({
    fontFamily: "var(--vscode-editor-font-family, monospace)",
    fontSize: "11.5px",
    padding: "0 6px",
    borderRadius: "3px",
    background: "var(--vscode-textCodeBlock-background)",
    color: "var(--vscode-textPreformat-foreground)",
});

const NameInput = styled("input", { shouldForwardProp: (prop) => prop !== "invalid" })<{ invalid: boolean }>(({ invalid }: { invalid: boolean }) => ({
    fontFamily: "var(--vscode-editor-font-family, monospace)",
    fontSize: "11.5px",
    width: "220px",
    maxWidth: "100%",
    padding: "1px 6px",
    borderRadius: "3px",
    color: "var(--vscode-input-foreground)",
    background: "var(--vscode-input-background)",
    border: `1px solid ${invalid ? "var(--vscode-inputValidation-errorBorder)" : "var(--vscode-focusBorder)"}`,
    outline: "none",
}));

const IconButton = styled.button({
    display: "inline-flex",
    alignItems: "center",
    padding: "0 2px",
    border: 0,
    background: "transparent",
    color: ThemeColors.ON_SURFACE_VARIANT,
    cursor: "pointer",
});

const Problem = styled.span({
    width: "100%",
    color: "var(--vscode-errorForeground)",
});

export interface ConfigurableLineProps {
    /** The field's path in the record, which names the line's elements for tests. */
    path: string;
    /** Whether the field's value is made configurable. */
    on: boolean;
    /** The configurable's name, once the language server has worked it out or the user has given one. */
    name?: string;
    /** Why the field can't get this configurable, as the language server reports it. */
    error?: string;
    /** Whether the name is being edited; `draft` holds what has been typed. */
    editing: boolean;
    draft?: string;
    onToggle: (on: boolean) => void;
    onStartRename: () => void;
    onDraftChange: (draft: string) => void;
    onCommit: () => void;
    onCancel: () => void;
}

/**
 * The line under a connection field's value that makes it configurable: a checkbox, the configurable's generated
 * name, which the user can rename, and a tooltip saying what it does.
 */
export function ConfigurableLine(props: ConfigurableLineProps) {
    const { path, on, name, error, editing, draft, onToggle, onStartRename, onDraftChange, onCommit, onCancel } = props;
    const invalidDraft = editing && draft !== undefined && !isValidConfigurableName(draft.trim());

    return (
        <Line data-testid={`record-form-configurable-${path}`}>
            <Toggle on={on}>
                <VSCodeCheckbox
                    checked={on}
                    aria-label="Make configurable"
                    data-testid={`record-form-configurable-toggle-${path}`}
                    onChange={(event: Event | React.FormEvent<HTMLElement>) =>
                        onToggle((event.target as HTMLInputElement).checked)}
                />
                <Icon
                    name="configurable-icon"
                    sx={{ fontSize: "14px", width: "14px", height: "14px", display: "flex", alignItems: "center",
                        justifyContent: "center", cursor: "inherit" }}
                    iconSx={{ fontSize: "10.5px" }}
                />
                <span>Make configurable</span>
            </Toggle>
            {on && editing && (
                <>
                    <NameInput
                        autoFocus
                        invalid={invalidDraft}
                        aria-label="Configurable name"
                        aria-invalid={invalidDraft}
                        data-testid={`record-form-configurable-name-input-${path}`}
                        value={draft ?? name ?? ""}
                        onChange={(event) => onDraftChange(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") {
                                event.preventDefault();
                                onCommit();
                            } else if (event.key === "Escape") {
                                event.preventDefault();
                                event.stopPropagation();
                                onCancel();
                            }
                        }}
                    />
                    <IconButton type="button" aria-label="Done" onClick={onCommit}>
                        <Codicon name="check" />
                    </IconButton>
                </>
            )}
            {on && !editing && name && (
                <>
                    <Name data-testid={`record-form-configurable-name-${path}`}>{name}</Name>
                    <IconButton
                        type="button"
                        aria-label="Rename configurable"
                        data-testid={`record-form-configurable-rename-${path}`}
                        onClick={onStartRename}
                    >
                        <Codicon name="edit" />
                    </IconButton>
                </>
            )}
            <Tooltip content={CONFIGURABLE_HELP}>
                <Codicon name="info" sx={{ color: ThemeColors.ON_SURFACE_VARIANT, cursor: "help" }} />
            </Tooltip>
            {invalidDraft && <Problem role="alert">{INVALID_NAME}</Problem>}
            {on && !invalidDraft && error && <Problem role="alert">{error}</Problem>}
        </Line>
    );
}
