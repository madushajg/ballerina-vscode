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

import type { Member } from "../interfaces/extended-lang-client";

/**
 * A GraphQL field argument, with its type in SDL notation.
 */
export interface GraphqlSdlArgument {
    name: string;
    type: string;
    defaultValue?: string;
}

/**
 * A GraphQL field, with its output type in SDL notation.
 */
export interface GraphqlSdlField {
    args?: GraphqlSdlArgument[];
    type: string;
    description?: string;
    deprecated?: boolean;
}

// A diagram row has room for about two typed arguments; anything beyond that is elided inline and
// listed in full in the row tooltip, the same split GraphiQL and Apollo Studio use between a field
// list and its detail view.
export const MAX_INLINE_GRAPHQL_ARGS = 2;

// A default makes the argument optional to pass even when its type is non-null (`name: String! = ""`),
// so it is part of the argument wherever the argument is shown.
const formatArgument = (arg: GraphqlSdlArgument): string =>
    arg.defaultValue !== undefined && arg.defaultValue !== null
        ? `${arg.name}: ${arg.type} = ${arg.defaultValue}`
        : `${arg.name}: ${arg.type}`;

/**
 * The name a GraphQL client sees for a Ballerina identifier, e.g. `'type` is exposed as `type` and
 * `n\u{61}me` as `name`.
 */
export function toGraphqlName(identifier: string): string {
    return (identifier ?? "")
        .replace(/^'/, "")
        .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/\\(.)/g, "$1");
}

/**
 * The arguments of a field in the GraphQL type model: the parameters carrying a GraphQL type. Runtime-injected
 * parameters (`graphql:Context`, `graphql:Field`) carry none, as they are not schema arguments.
 */
export function toGraphqlArgs(parameters: Member[]): GraphqlSdlArgument[] {
    return (parameters ?? [])
        .filter((param) => param.graphqlType)
        .map((param) => ({ name: toGraphqlName(param.name), type: param.graphqlType, defaultValue: param.defaultValue }));
}

/**
 * What a diagram row puts after a field's SDL type when its resolver can return an error, e.g. `Person|error`.
 * GraphQL has no error type, so this is a design-view marker rather than SDL: it is kept out of the field's SDL
 * definition and shown apart from the type.
 */
export const GRAPHQL_ERROR_SUFFIX = "|error";

/**
 * What a resolver error does to the response, for a field whose resolver can return one. The error is listed in the
 * response's `errors` and the field resolves to null; a non-null field cannot hold that null, so it moves up to the
 * nearest nullable parent, which for a root operation field is the response's whole `data`.
 *
 * @param type   the field's SDL type, e.g. `Person!`
 * @param parent the object type holding the field, or undefined for a root operation field
 */
export function describeGraphqlResolverError(type: string, parent?: string): string {
    if (!type.endsWith("!")) {
        return "Can return an error. The field is then null and the error is listed in the response's errors.";
    }
    const lost = parent
        ? `the ${parent} holding it null too, and further up through non-null parents`
        : "the response's whole data null";
    return `Can return an error. As the field is non-null, an error makes ${lost}. `
        + "Make the field nullable to keep the rest of the response.";
}

/**
 * The argument list shown next to a field name in a diagram, e.g. `(id: ID!, first: Int! = 10)`.
 */
export function formatInlineGraphqlArgs(args: GraphqlSdlArgument[]): string {
    if (!args?.length) {
        return "";
    }
    const shown = args.slice(0, MAX_INLINE_GRAPHQL_ARGS).map(formatArgument);
    if (args.length > MAX_INLINE_GRAPHQL_ARGS) {
        shown.push("…");
    }
    return `(${shown.join(", ")})`;
}

/**
 * The full field definition in SDL, e.g. `profile(id: ID!): Profile`, followed by its description.
 * A deprecated field carries the `@deprecated` directive, as in the schema.
 * Fields with more arguments than fit inline put one argument per line, as SDL formatters do.
 */
export function formatGraphqlFieldDefinition(name: string, field: GraphqlSdlField): string {
    const args = (field.args ?? []).map(formatArgument);
    let argList = "";
    if (args.length > MAX_INLINE_GRAPHQL_ARGS) {
        argList = `(\n${args.map((arg) => `  ${arg}`).join("\n")}\n)`;
    } else if (args.length) {
        argList = `(${args.join(", ")})`;
    }
    const lines = [`${name}${argList}: ${field.type}${field.deprecated ? " @deprecated" : ""}`];
    if (field.description) {
        lines.push("", field.description);
    }
    return lines.join("\n");
}
