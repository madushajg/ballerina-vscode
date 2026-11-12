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

// Which fields of a new connection's record the form offers to make configurable, and what it sends the language
// server about them (`codedata.data.configurables` of the argument's property).
//
// The language server (ConnectionConfigurables) turns every simple literal of a new connection into a configurable,
// walking records field by field but never into a list. So the form offers the same fields, keyed by the same dotted
// path, and, since an optional field starts unchecked, says `keep` for each one the user hasn't checked.

import type { ConnectionConfigurableChoice, ConnectionConfigurableChoices, TypeField } from "@wso2/ballerina-core";
import { childPath, fieldKind, isRequiredField, sectionRecord, shownFields } from "./model";

/** The fields a configurable can stand for: the checked simple fields, through records but not into lists. */
export function configurableFields(record: TypeField, path = ""): { path: string; field: TypeField }[] {
    const found: { path: string; field: TypeField }[] = [];
    for (const field of shownFields(record)) {
        const here = childPath(path, field.name);
        const kind = fieldKind(field);
        if (kind === "primitive") {
            found.push({ path: here, field });
        } else if (kind === "record") {
            found.push(...configurableFields(sectionRecord(field), here));
        }
    }
    return found;
}

/** Whether a field's value is made configurable: as the user chose, else by default when the field is required. */
export function isConfigurable(field: TypeField, choice: ConnectionConfigurableChoice | undefined): boolean {
    return choice ? !choice.keep : isRequiredField(field);
}

/**
 * What to tell the language server for the record's fields: `keep` for each one that stays a literal, and the name
 * for each one the user named. A field made configurable under its generated name needs no entry.
 */
export function choicesToSend(record: TypeField, choices: ConnectionConfigurableChoices): ConnectionConfigurableChoices {
    const send: ConnectionConfigurableChoices = {};
    for (const { path, field } of configurableFields(record)) {
        const choice = choices[path];
        if (!isConfigurable(field, choice)) {
            send[path] = { keep: true };
        } else if (choice?.name) {
            send[path] = { name: choice.name };
        }
    }
    return send;
}

/** Whether a configurable's name is an identifier the language server accepts. */
export function isValidConfigurableName(name: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}
