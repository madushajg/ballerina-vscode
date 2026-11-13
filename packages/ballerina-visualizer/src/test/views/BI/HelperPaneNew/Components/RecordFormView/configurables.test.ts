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

// L1: which fields of a new connection's record the form offers to make configurable, and what it tells the
// language server about them. The language server makes every simple literal configurable unless told to keep it,
// walking records but not lists, so the form must name the same fields by the same paths, and say `keep` for each
// optional one the user hasn't checked.

import type { TypeField } from "@wso2/ballerina-core";
import { loadFixtures } from "@wso2/test-config/fixtures";
import { normalizeIntersections } from "../../../../../../views/BI/HelperPaneNew/Components/RecordConstructView/utils/intersection";
import {
    choicesToSend,
    configurableFields,
    fieldAtPath,
    replaceIdentifiers,
    isConfigurable,
    isValidConfigurableName,
} from "../../../../../../views/BI/HelperPaneNew/Components/RecordFormView/configurables";
import { fieldKind, isPrimitiveTypeName } from "../../../../../../views/BI/HelperPaneNew/Components/RecordFormView/model";

interface RecordConfigFixture {
    recordConfig: TypeField;
}

const fixtures = loadFixtures<RecordConfigFixture>(
    __dirname, "..", "RecordConstructView", "utils", "fixtures", "recordConfigs");

/** The Salesforce connection config: a required token under auth, an optional URL, a list, an unchecked field. */
function connectionConfig(): TypeField {
    return {
        typeName: "record",
        name: "ConnectionConfig",
        selected: true,
        fields: [
            {
                typeName: "record", name: "auth", selected: true,
                fields: [{ typeName: "string", name: "token", selected: true }],
            },
            { typeName: "string", name: "baseUrl", selected: true, optional: true },
            { typeName: "decimal", name: "timeout", selected: true, defaultable: true },
            { typeName: "string", name: "forwarded", selected: false, defaultable: true },
            {
                typeName: "array", name: "tags", selected: true, defaultable: true,
                memberType: { typeName: "string" },
                elements: [{ typeName: "string", selected: true, value: "\"gift\"" }],
            },
            {
                typeName: "union", name: "httpVersion", selected: true, defaultable: true,
                members: [{ typeName: "HTTP_1_1" }, { typeName: "HTTP_2_0", selected: true }],
            },
        ],
    };
}

describe("fields a configurable can stand for", () => {
    it("are the checked simple fields, by their path through records", () => {
        expect(configurableFields(connectionConfig()).map(({ path }) => path))
            .toEqual(["auth.token", "baseUrl", "timeout"]);
    });

    it("leave out lists, which the language server doesn't look into, and choices", () => {
        const paths = configurableFields(connectionConfig()).map(({ path }) => path);
        expect(paths).not.toContain("tags");
        expect(paths.some((path) => path.startsWith("tags"))).toBe(false);
        expect(paths).not.toContain("httpVersion");
    });

    describe.each(fixtures.map(({ name, data }) => [name, data] as [string, RecordConfigFixture]))(
        "over %s",
        (_name, fixture) => {
            it("every one is a simple field the form edits as a literal", () => {
                const record = normalizeIntersections(fixture.recordConfig);
                const selectAll = (node: TypeField) => (node.fields ?? []).forEach((field) => {
                    field.selected = true;
                    selectAll(field);
                });
                selectAll(record);
                configurableFields(record).forEach(({ path, field }) => {
                    expect({ path, primitive: fieldKind(field) === "primitive" }).toEqual({ path, primitive: true });
                    if (field.typeName !== "union") {
                        expect(isPrimitiveTypeName(field.typeName)).toBe(true);
                    }
                });
            });
        });
});

describe("made configurable", () => {
    const token = { typeName: "string", name: "token" };
    const baseUrl = { typeName: "string", name: "baseUrl", optional: true };

    it("by default when the field is required, and not when it is optional", () => {
        expect(isConfigurable(token, undefined)).toBe(true);
        expect(isConfigurable(baseUrl, undefined)).toBe(false);
    });

    it("as the user chose otherwise", () => {
        expect(isConfigurable(token, { keep: true })).toBe(false);
        expect(isConfigurable(baseUrl, { keep: false })).toBe(true);
    });
});

describe("what the language server is told", () => {
    it("keeps each optional field the user hasn't checked, and says nothing of a required one", () => {
        expect(choicesToSend(connectionConfig(), {})).toEqual({
            baseUrl: { keep: true },
            timeout: { keep: true },
        });
    });

    it("follows what the user chose, with any name they gave", () => {
        expect(choicesToSend(connectionConfig(), {
            "auth.token": { keep: true },
            baseUrl: { keep: false, name: "salesforceUrl" },
        })).toEqual({
            "auth.token": { keep: true },
            baseUrl: { name: "salesforceUrl" },
            timeout: { keep: true },
        });
    });

    it("forgets a choice for a field no longer checked", () => {
        const record = connectionConfig();
        record.fields![1].selected = false;
        expect(choicesToSend(record, { baseUrl: { name: "salesforceUrl" } })).toEqual({ timeout: { keep: true } });
    });
});

describe("a configurable the connection already uses", () => {
    it("is sent by its name, marked as one the connection keeps using", () => {
        expect(choicesToSend(connectionConfig(), {
            "auth.token": { name: "sfToken", existing: true, renameTo: "salesforceToken" },
        })).toEqual({
            "auth.token": { name: "sfToken", existing: true },
            baseUrl: { keep: true },
            timeout: { keep: true },
        });
    });

    it("turns back into a value when unchecked", () => {
        expect(choicesToSend(connectionConfig(), { "auth.token": { name: "sfToken", existing: true, keep: true } })
            ["auth.token"]).toEqual({ keep: true });
    });
});

describe("a field by its path", () => {
    it("is found through records", () => {
        expect(fieldAtPath(connectionConfig(), "auth.token")?.name).toBe("token");
        expect(fieldAtPath(connectionConfig(), "timeout")?.typeName).toBe("decimal");
    });

    it("is not found when the path names no field", () => {
        expect(fieldAtPath(connectionConfig(), "auth.secret")).toBeUndefined();
        expect(fieldAtPath(connectionConfig(), "proxy.host")).toBeUndefined();
    });
});

describe("names in the code view", () => {
    const values = { sfBaseUrl: "\"https://api\"", sfToken: "\"tkn\"" };

    it("stand for their values", () => {
        expect(replaceIdentifiers("{baseUrl: sfBaseUrl, auth: {token: sfToken}}", values))
            .toBe("{baseUrl: \"https://api\", auth: {token: \"tkn\"}}");
    });

    it("are not looked for inside strings, templates or longer names", () => {
        expect(replaceIdentifiers("{a: \"sfToken\", b: string `sfToken`, c: sfTokenOld}", values))
            .toBe("{a: \"sfToken\", b: string `sfToken`, c: sfTokenOld}");
    });

    it("leave source untouched when there are none", () => {
        expect(replaceIdentifiers("{baseUrl: sfBaseUrl}", {})).toBe("{baseUrl: sfBaseUrl}");
    });
});

describe("configurable names", () => {
    it.each(["apiToken", "_token", "sf_sales2"])("accepts %s", (name) => {
        expect(isValidConfigurableName(name)).toBe(true);
    });

    it.each(["2token", "api token", "api-token", ""])("refuses %j", (name) => {
        expect(isValidConfigurableName(name)).toBe(false);
    });
});
