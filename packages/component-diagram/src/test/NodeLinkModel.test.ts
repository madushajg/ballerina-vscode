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

import {
    buildRoundedOrthogonalPath,
    NodeLinkModel,
    orthogonalizePoints,
    Point2D,
    sampleRoundedOrthogonalPath,
} from "../components/NodeLink/NodeLinkModel";
import { ENTRY_NODE_WIDTH, NODE_GAP_X } from "../resources/constants";

/** Mirrors the private LINK_CORNER_RADIUS constant in NodeLinkModel.ts. */
const LINK_CORNER_RADIUS = 10;

function distance(a: Point2D, b: Point2D): number {
    return Math.hypot(b.x - a.x, b.y - a.y);
}

type PathCommand = { type: "L"; to: Point2D } | { type: "Q"; approach: Point2D; corner: Point2D; departure: Point2D };

/**
 * Parses a path built by buildRoundedOrthogonalPath back into its start point and each command:
 * a straight "L" leg, or a rounded "Q" corner (the "L approach" that always precedes a "Q" in the
 * production output is folded into that same corner's `approach` field).
 */
function parsePath(path: string): { start: Point2D; commands: PathCommand[] } {
    const tokens = [...path.matchAll(/([MLQ])((?:\s+-?[\d.]+){2,4})/g)].map((m) => ({
        cmd: m[1],
        coords: m[2].trim().split(/\s+/).map(Number),
    }));
    const start = { x: tokens[0].coords[0], y: tokens[0].coords[1] };
    const commands: PathCommand[] = [];
    for (let i = 1; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.cmd === "L") {
            commands.push({ type: "L", to: { x: token.coords[0], y: token.coords[1] } });
        } else if (token.cmd === "Q") {
            const approach = (commands.pop() as { type: "L"; to: Point2D }).to;
            commands.push({
                type: "Q",
                approach,
                corner: { x: token.coords[0], y: token.coords[1] },
                departure: { x: token.coords[2], y: token.coords[3] },
            });
        }
    }
    return { start, commands };
}

/** Builds a plain NodeLinkModel with exactly the given points (no ports attached). */
function buildLinkWithPoints(points: Point2D[]): NodeLinkModel {
    const link = new NodeLinkModel({ visible: true });
    link.getFirstPoint().setPosition(points[0].x, points[0].y);
    for (let i = 1; i < points.length - 1; i++) {
        link.point(points[i].x, points[i].y, i);
    }
    link.getLastPoint().setPosition(points[points.length - 1].x, points[points.length - 1].y);
    return link;
}

describe("orthogonalizePoints", () => {
    test("snaps 2 near-level endpoints (within STRAIGHT_TOLERANCE) flat instead of leaving a faint diagonal", () => {
        const points = orthogonalizePoints([{ x: 0, y: 100 }, { x: 300, y: 104 }]); // dy = 4
        expect(points).toEqual([{ x: 0, y: 102 }, { x: 300, y: 102 }]);
    });

    test("a plain 2-point link with different Y gets one midpoint bend, leaving/arriving horizontally", () => {
        const source = { x: 0, y: 32 };
        const target = { x: 400, y: 232 };
        expect(orthogonalizePoints([source, target])).toEqual([
            source,
            { x: 200, y: source.y },
            { x: 200, y: target.y },
            target,
        ]);
    });

    test("a 4-point detour jogs only the outer legs, leaving the flat middle lane untouched", () => {
        const source = { x: 0, y: 32 };
        const bend1 = { x: 200, y: 84 };
        const bend2 = { x: 500, y: 84 };
        const target = { x: 700, y: 232 };
        expect(orthogonalizePoints([source, bend1, bend2, target])).toEqual([
            source,
            { x: bend1.x, y: source.y }, // jogInto corner: sits at bend1's X, so it arrives at bend1 vertically
            bend1,
            bend2,
            { x: bend2.x, y: target.y }, // jogOutOf corner: sits at bend2's X, so it arrives at target horizontally
            target,
        ]);
    });

    test("skips a leg's jog entirely when it is already level with its lane", () => {
        const source = { x: 0, y: 84 }; // level with bend1
        const bend1 = { x: 200, y: 84 };
        const bend2 = { x: 500, y: 84 };
        const target = { x: 700, y: 88 }; // level with bend2 within tolerance
        expect(orthogonalizePoints([source, bend1, bend2, target])).toEqual([source, bend1, bend2, target]);
    });
});

describe("buildRoundedOrthogonalPath", () => {
    test("a straight 2-point path draws a single L, no rounding applied", () => {
        expect(buildRoundedOrthogonalPath([{ x: 0, y: 0 }, { x: 300, y: 0 }])).toBe("M 0 0 L 300 0");
    });

    test("rounds a single interior corner, setting the approach/departure back by the corner radius", () => {
        const source = { x: 0, y: 0 };
        const corner = { x: 100, y: 0 };
        const target = { x: 100, y: 100 };
        const { start, commands } = parsePath(buildRoundedOrthogonalPath([source, corner, target]));

        expect(start).toEqual(source);
        // The rounded corner, then the trailing straight leg from its departure to `target`.
        expect(commands).toHaveLength(2);
        const q = commands[0];
        expect(q.type).toBe("Q");
        if (q.type === "Q") {
            expect(q.corner).toEqual(corner);
            expect(q.approach).toEqual({ x: corner.x - LINK_CORNER_RADIUS, y: corner.y });
            expect(q.departure).toEqual({ x: corner.x, y: corner.y + LINK_CORNER_RADIUS });
        }
        expect(commands[1]).toEqual({ type: "L", to: target });
    });

    test("clamps the radius to half of a short adjacent segment instead of overshooting past it", () => {
        const source = { x: 0, y: 0 };
        const corner = { x: 6, y: 0 }; // half of this 6px leg (3) is below LINK_CORNER_RADIUS (10)
        const target = { x: 6, y: 100 };
        const { commands } = parsePath(buildRoundedOrthogonalPath([source, corner, target]));
        const q = commands[0];
        expect(q.type).toBe("Q");
        if (q.type === "Q") {
            expect(distance(source, q.approach)).toBeCloseTo(3);
        }
    });

    test("chains multiple rounded corners, each curve confined to its own (approach, corner, departure) triangle", () => {
        const points: Point2D[] = [
            { x: 0, y: 32 },
            { x: 200, y: 32 },
            { x: 200, y: 84 },
            { x: 500, y: 84 },
            { x: 500, y: 232 },
            { x: 700, y: 232 },
        ];
        const { start, commands } = parsePath(buildRoundedOrthogonalPath(points));

        expect(start).toEqual(points[0]);
        expect(commands.filter((c) => c.type === "Q")).toHaveLength(4);

        // Every quadratic's approach/departure sit within LINK_CORNER_RADIUS of their corner, so
        // the curve (a convex combination of the 3) can only move inward from the sharp corner,
        // never past where it already was.
        commands.forEach((command) => {
            if (command.type === "Q") {
                expect(distance(command.approach, command.corner)).toBeLessThanOrEqual(LINK_CORNER_RADIUS + 1e-9);
                expect(distance(command.departure, command.corner)).toBeLessThanOrEqual(LINK_CORNER_RADIUS + 1e-9);
            }
        });
    });

    test("a very narrow lane (bends close together) still produces two valid, non-overshooting corners", () => {
        const points: Point2D[] = [{ x: 0, y: 0 }, { x: 100, y: 50 }, { x: 106, y: 50 }, { x: 300, y: 200 }];
        const { commands } = parsePath(buildRoundedOrthogonalPath(points));
        const corners = commands.filter((c): c is Extract<PathCommand, { type: "Q" }> => c.type === "Q");
        expect(corners).toHaveLength(2);
        const [corner1, corner2] = corners;

        // The narrow 6px leg between the two corners is shared: corner1's departure and corner2's
        // approach both back off into it, and must stay inside it without crossing each other -
        // i.e. not eat further into the leg than the other corner's own rounding does.
        expect(corner1.departure.x).toBeGreaterThanOrEqual(100);
        expect(corner1.departure.x).toBeLessThanOrEqual(106);
        expect(corner2.approach.x).toBeGreaterThanOrEqual(100);
        expect(corner2.approach.x).toBeLessThanOrEqual(106);
        expect(corner1.departure.x).toBeLessThanOrEqual(corner2.approach.x);
    });
});

describe("sampleRoundedOrthogonalPath", () => {
    test("starts and ends at the path's own endpoints", () => {
        const points: Point2D[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
        const sampled = sampleRoundedOrthogonalPath(points, 8);
        expect(sampled[0]).toEqual(points[0]);
        expect(sampled[sampled.length - 1]).toEqual(points[points.length - 1]);
    });

    test("every sampled point around a rounded corner lies on the same quadratic the path string draws", () => {
        const points: Point2D[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
        const cornerSamples = 10;
        const sampled = sampleRoundedOrthogonalPath(points, cornerSamples);
        const { commands } = parsePath(buildRoundedOrthogonalPath(points));
        const q = commands[0];
        expect(q.type).toBe("Q");
        if (q.type !== "Q") {
            return;
        }
        for (let step = 1; step <= cornerSamples; step++) {
            const t = step / cornerSamples;
            const u = 1 - t;
            const expected = {
                x: u * u * q.approach.x + 2 * u * t * q.corner.x + t * t * q.departure.x,
                y: u * u * q.approach.y + 2 * u * t * q.corner.y + t * t * q.departure.y,
            };
            const actual = sampled.find(
                (p) => Math.abs(p.x - expected.x) < 1e-6 && Math.abs(p.y - expected.y) < 1e-6
            );
            expect(actual).toBeDefined();
        }
    });

    test("a straight segment (no corner) is not over-sampled - endpoints only", () => {
        const sampled = sampleRoundedOrthogonalPath([{ x: 0, y: 0 }, { x: 300, y: 0 }], 20);
        expect(sampled).toEqual([{ x: 0, y: 0 }, { x: 300, y: 0 }]);
    });
});

describe("NodeLinkModel.getSVGPath", () => {
    test("matches buildRoundedOrthogonalPath(orthogonalizePoints(...)) for a plain 2-point link", () => {
        const points: Point2D[] = [{ x: 240, y: 32 }, { x: 800, y: 232 }];
        const link = buildLinkWithPoints(points);
        expect(link.getSVGPath()).toBe(buildRoundedOrthogonalPath(orthogonalizePoints(points)));
    });

    test("matches buildRoundedOrthogonalPath(orthogonalizePoints(...)) for a real 4-point detour", () => {
        // Mirrors a real avoidLinkObstructions detour (see utils/diagram.ts), using this diagram's
        // actual column-spacing constants.
        const start: Point2D = { x: ENTRY_NODE_WIDTH, y: 32 };
        const bend1: Point2D = { x: ENTRY_NODE_WIDTH + NODE_GAP_X - NODE_GAP_X / 4, y: 84 };
        const bend2: Point2D = { x: ENTRY_NODE_WIDTH + NODE_GAP_X + ENTRY_NODE_WIDTH + NODE_GAP_X / 4, y: 84 };
        const end: Point2D = { x: 2 * (ENTRY_NODE_WIDTH + NODE_GAP_X) + ENTRY_NODE_WIDTH, y: 232 };
        const points = [start, bend1, bend2, end];
        const link = buildLinkWithPoints(points);
        expect(link.getSVGPath()).toBe(buildRoundedOrthogonalPath(orthogonalizePoints(points)));
    });
});
