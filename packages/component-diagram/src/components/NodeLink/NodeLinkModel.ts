/**
 * Copyright (c) 2025, WSO2 LLC. (https://www.wso2.com) All Rights Reserved.
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

import { DefaultLinkModel } from "@projectstorm/react-diagrams";
import { ThemeColors } from "@wso2/ui-toolkit";
import { NODE_LINK } from "../../resources/constants";
import { NodeModel } from "../../utils/types";

export const LINK_BOTTOM_OFFSET = 30;

export interface Point2D {
    x: number;
    y: number;
}

/**
 * Below this vertical gap between two consecutive points, a jog would be a hairline the eye can't
 * follow, so orthogonalizePoints draws a plain straight segment there instead of inserting one.
 */
const STRAIGHT_TOLERANCE = 8;

/**
 * Radius of the quadratic-bezier round applied to each interior corner of an orthogonal link (see
 * buildRoundedOrthogonalPath). Small on purpose: this is softening a 90 degree turn, not drawing a
 * curve - a bigger radius would start to look like the smooth S-curve style this replaced.
 */
const LINK_CORNER_RADIUS = 10;

/**
 * Expands the logical waypoints a link is built from into a fully axis-aligned point list -
 * `[source, target]` for a plain link, or `[source, bend1, bend2, target]` for one
 * `avoidLinkObstructions` (utils/diagram.ts) routed around an obstruction, where
 * `bend1.y === bend2.y` is the flat detour lane.
 *
 * Every node port sits at its own node's left (in) or right (out) edge (see `LeftPortWidget`/
 * `RightPortWidget` in ConnectionNodeWidget.tsx/ListenerNodeWidget.tsx, and the equivalent
 * first/last-child pairing for entry nodes), so a link should always leave its source and arrive
 * at its target horizontally. This inserts one vertical jog per gap that isn't already aligned,
 * skipping it entirely when the gap is under STRAIGHT_TOLERANCE (a jog that small would read as a
 * pointless wiggle rather than a real corner).
 *
 * A plain 2-point link is neither a source nor a target at its bend, so the one jog it gets has to
 * satisfy both ends at once: it sits at the horizontal midpoint between them, leaving source
 * horizontally and, after the vertical run, arriving at target horizontally too.
 *
 * The 4-point case's middle leg (bend1 -> bend2) is already horizontal by construction and is left
 * untouched; only the two outer legs, which run diagonally from a port to the lane today, get a
 * jog each - leaving `source` horizontally to arrive at `bend1` vertically (the corner sits at
 * `bend1`'s own X, since `bend1` is about to continue horizontally into the lane), and leaving
 * `bend2` vertically to arrive at `target` horizontally (the corner sits at `bend2`'s own X, since
 * `bend2` just finished running horizontally) - so every leg still leaves and arrives the way a
 * port actually faces.
 */
export function orthogonalizePoints(points: Point2D[]): Point2D[] {
    if (points.length <= 2) {
        const source = points[0];
        const target = points[points.length - 1];
        // No lane to hand off to here - both ends are real ports, so the single jog has to leave
        // source AND arrive at target horizontally. A corner at either endpoint's own X would
        // satisfy one side but not the other, so it sits at the midpoint instead.
        if (Math.abs(source.y - target.y) < STRAIGHT_TOLERANCE) {
            // Skipping the jog is only worth it if the result actually reads as level - leaving
            // the two ends at their own slightly different Y (anywhere up to STRAIGHT_TOLERANCE
            // apart) draws a faint diagonal instead, which over a long horizontal span is exactly
            // as noticeable as a real, larger-angle line. Meeting in the middle keeps each end off
            // its own true anchor by at most half the tolerance, rather than a visible full-width
            // tilt.
            const flatY = (source.y + target.y) / 2;
            return [{ x: source.x, y: flatY }, { x: target.x, y: flatY }];
        }
        const bendX = (source.x + target.x) / 2;
        return [source, { x: bendX, y: source.y }, { x: bendX, y: target.y }, target];
    }

    const [source, bend1, bend2, target] = points;
    // Leave `from` horizontally, arrive at `to` vertically: the corner sits at `to`'s own X. Used
    // for the leg into the lane (source -> bend1), where `to` is about to continue horizontally.
    const jogInto = (from: Point2D, to: Point2D): Point2D[] =>
        Math.abs(from.y - to.y) < STRAIGHT_TOLERANCE ? [from, to] : [from, { x: to.x, y: from.y }, to];
    // Leave `from` vertically, arrive at `to` horizontally: the corner sits at `from`'s own X. Used
    // for the leg out of the lane (bend2 -> target), where `from` just finished running horizontally.
    const jogOutOf = (from: Point2D, to: Point2D): Point2D[] =>
        Math.abs(from.y - to.y) < STRAIGHT_TOLERANCE ? [from, to] : [from, { x: from.x, y: to.y }, to];

    return [...jogInto(source, bend1), bend2, ...jogOutOf(bend2, target).slice(1)];
}

function distance(a: Point2D, b: Point2D): number {
    return Math.hypot(b.x - a.x, b.y - a.y);
}

/** The point `length` away from `from`, heading towards `to` (clamped at `to`). */
function towards(from: Point2D, to: Point2D, length: number): Point2D {
    const total = distance(from, to);
    if (total === 0) {
        return from;
    }
    const t = Math.min(length, total) / total;
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

/**
 * Serializes an already-orthogonalized point list (see `orthogonalizePoints`) as an SVG path:
 * straight `L` segments between consecutive points, with every *interior* point - never the
 * first or last, which are real port endpoints, not corners this function introduces - rounded
 * into a short quadratic-bezier curve rather than a sharp corner.
 *
 * The curve's control point is the corner itself, and the approach/departure points sit `radius`
 * back along the corner's incoming/outgoing segment (clamped to at most half of whichever
 * adjacent segment is shorter, so two nearby corners' curves can never cross). That choice of
 * control point is what makes the rounding safe to layer on top of `avoidLinkObstructions`'s
 * routing without re-proving anything: a quadratic bezier is, at every t, a convex combination of
 * its start, control, and end points, so it can never leave the triangle (approach, corner,
 * departure) - it can only move *inward* from the corner, never bulge outward past where the
 * sharp corner already was. Every corner here sits exactly where the routing pass already placed
 * it with a safe margin, so rounding can only add clearance from an obstruction, never remove it -
 * the same argument this diagram used for its previous (bezier) rendering style, simpler here
 * since a straight segment's bounding box is just the segment, with no curve to bulge at all.
 */
export function buildRoundedOrthogonalPath(points: Point2D[]): string {
    const [start, ...rest] = points;
    let path = `M ${start.x} ${start.y}`;
    let cursor = start;
    for (let i = 0; i < rest.length - 1; i++) {
        const corner = rest[i];
        const next = rest[i + 1];
        const radius = Math.min(LINK_CORNER_RADIUS, distance(cursor, corner) / 2, distance(corner, next) / 2);
        if (radius <= 0) {
            path += ` L ${corner.x} ${corner.y}`;
            cursor = corner;
            continue;
        }
        const approach = towards(corner, cursor, radius);
        const departure = towards(corner, next, radius);
        path += ` L ${approach.x} ${approach.y} Q ${corner.x} ${corner.y} ${departure.x} ${departure.y}`;
        cursor = departure;
    }
    const end = rest[rest.length - 1];
    path += ` L ${end.x} ${end.y}`;
    return path;
}

/** The point at parameter `t` (0..1) on the quadratic bezier (start, control, end). */
function pointOnQuadratic(start: Point2D, control: Point2D, end: Point2D, t: number): Point2D {
    const u = 1 - t;
    const a = u * u;
    const b = 2 * u * t;
    const c = t * t;
    return { x: a * start.x + b * control.x + c * end.x, y: a * start.y + b * control.y + c * end.y };
}

/**
 * Approximates the path `buildRoundedOrthogonalPath` draws through `points` as a dense polyline -
 * a straight segment needs only its 2 endpoints (there's no curvature to miss), each small rounded
 * corner gets `cornerSamples` real points along its actual curve.
 *
 * This is how a caller asks "where does this link actually run?" without duplicating the rounding
 * math - see `test/linkOverlapChecker.ts`, which checks the real rendered path rather than
 * asserting the safety argument above holds without looking.
 */
export function sampleRoundedOrthogonalPath(points: Point2D[], cornerSamples: number): Point2D[] {
    const samples: Point2D[] = [points[0]];
    const [start, ...rest] = points;
    let cursor = start;
    for (let i = 0; i < rest.length - 1; i++) {
        const corner = rest[i];
        const next = rest[i + 1];
        const radius = Math.min(LINK_CORNER_RADIUS, distance(cursor, corner) / 2, distance(corner, next) / 2);
        const approach = radius > 0 ? towards(corner, cursor, radius) : corner;
        const departure = radius > 0 ? towards(corner, next, radius) : corner;
        samples.push(approach);
        if (radius > 0) {
            for (let step = 1; step <= cornerSamples; step++) {
                samples.push(pointOnQuadratic(approach, corner, departure, step / cornerSamples));
            }
        }
        cursor = departure;
    }
    samples.push(rest[rest.length - 1]);
    return samples;
}

export interface NodeLinkModelOptions {
    label?: string;
    visible: boolean;
    broken?: boolean;
    // neutral dashed link (e.g. a read-only interaction with a durable agent)
    dashed?: boolean;
    onAddClick?: () => void;
}

export class NodeLinkModel extends DefaultLinkModel {
    sourceNode: NodeModel;
    targetNode: NodeModel;
    // options
    label: string;
    visible = true;
    // marks a link that cannot be resolved statically (e.g. a workflow:sendData call whose
    // data event name does not match any event declared by the workflow)
    broken = false;
    dashed = false;
    // call back
    onAddClick?: () => void;

    constructor(label?: string);
    constructor(options: NodeLinkModelOptions);
    constructor(options: NodeLinkModelOptions | string) {
        super({
            type: NODE_LINK,
            width: 10,
            color: ThemeColors.PRIMARY,
            selectedColor: ThemeColors.SECONDARY,
            curvyness: 0,
        });
        if (options) {
            if (typeof options === "string" && options.length > 0) {
                this.label = options;
            } else {
                if ((options as NodeLinkModelOptions).label) {
                    this.label = (options as NodeLinkModelOptions).label;
                }
                if ((options as NodeLinkModelOptions).visible === false) {
                    this.visible = (options as NodeLinkModelOptions).visible;
                }
                if ((options as NodeLinkModelOptions).broken) {
                    this.broken = true;
                }
                if ((options as NodeLinkModelOptions).dashed) {
                    this.dashed = true;
                }
            }
            if ((options as NodeLinkModelOptions).onAddClick) {
                this.onAddClick = (options as NodeLinkModelOptions).onAddClick;
            }
        }
    }

    setSourceNode(node: NodeModel) {
        this.sourceNode = node;
    }

    setTargetNode(node: NodeModel) {
        this.targetNode = node;
    }

    /**
     * DefaultLinkModel.getSVGPath() only knows how to draw a single bezier curve between
     * exactly 2 points, so it silently returns undefined for any link carrying extra waypoints.
     * Waypoints get added by avoidLinkObstructions() (see utils/diagram.ts) to route a link
     * around a node it would otherwise cut through.
     *
     * Every link - plain 2-point or multi-point detour alike - is drawn the same way: its logical
     * waypoints are expanded into a fully axis-aligned point list (see `orthogonalizePoints`) and
     * serialized as gently-rounded 90 degree elbows (see `buildRoundedOrthogonalPath`), for a
     * consistent architectural look across the whole diagram.
     */
    getSVGPath(): string {
        return buildRoundedOrthogonalPath(orthogonalizePoints(this.getPoints().map((point) => point.getPosition())));
    }
}
