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

/**
 * Identifier derivation for AI chat agents, shared by the in-package creation
 * form (`AIChatAgentWizard`, which uses it to validate a name against the design
 * model) and the extension host's agent orchestration (which uses it to name the
 * generated declarations). Both must derive the SAME identifiers from a given
 * display name, so they live here rather than being duplicated per package.
 */

/**
 * Suffixes stripped from a display name before derived identifiers are built, so
 * a name the user already qualified does not stutter — "Sales Agent" must yield
 * `salesAgent`, not `salesAgentAgent`.
 */
const KNOWN_AGENT_NAME_SUFFIXES = ["agent", "model"];

/**
 * Converts a free-form agent display name ("Customer Support Assistant") into a
 * Ballerina-friendly camelCase identifier ("customerSupportAssistant").
 *
 * Leading acronyms are lower-cased the way readers expect: "HR" → `hr`,
 * "HRPolicy" → `hrPolicy`. Returns an empty string for a blank name.
 */
export function toAgentCamelCase(name: string): string {
    // Split on spaces/underscores, convert to camelCase
    const words = name.trim().split(/[\s_]+/).filter(Boolean);
    if (words.length === 0) {
        return "";
    }
    const firstWord = words[0];
    // Lowercase leading acronyms: "HR" -> "hr", "HTMLParser" -> "htmlParser"
    const leadingUpper = firstWord.match(/^[A-Z]+/);
    let lowerFirst: string;
    if (leadingUpper && leadingUpper[0].length === firstWord.length) {
        // Entire word is uppercase: "HR" -> "hr"
        lowerFirst = firstWord.toLowerCase();
    } else if (leadingUpper && leadingUpper[0].length > 1) {
        // Acronym followed by more chars: "HRPolicy" -> "hrPolicy"
        lowerFirst = leadingUpper[0].slice(0, -1).toLowerCase() + firstWord.slice(leadingUpper[0].length - 1);
    } else {
        lowerFirst = firstWord.charAt(0).toLowerCase() + firstWord.slice(1);
    }
    return (
        lowerFirst + words.slice(1).map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join("")
    );
}

/**
 * The stem the agent's generated declarations are named from: the camelCase name
 * with a redundant trailing "agent"/"model" removed. The agent connection is then
 * `<base>Agent` and (for non-default providers) the model is `<base>Model`.
 */
export function toAgentBaseName(name: string): string {
    const camel = toAgentCamelCase(name);
    // Strip known suffixes to avoid e.g. "salesAgentAgent"
    const lower = camel.toLowerCase();
    for (const suffix of KNOWN_AGENT_NAME_SUFFIXES) {
        if (lower.endsWith(suffix) && lower.length > suffix.length) {
            return camel.slice(0, -suffix.length);
        }
    }
    return camel;
}
