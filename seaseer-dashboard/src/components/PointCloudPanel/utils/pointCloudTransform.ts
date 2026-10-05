import type { QuerySummaryData, ConnectedPointCloudMetadata, CustomQuery } from "../CustomQueryManager";
import { isConnectedPointCloudSelected } from "../CustomQueryManager";
import type { PointCloudMetadataResponse } from "../../../client";

export function getPointCloudTransform(
    queryId: string,
    summaryMap?: Record<string, QuerySummaryData>,
    catalog?: PointCloudMetadataResponse[],
    query?: CustomQuery
): { matrixArr?: number[]; center: [number, number, number] } {
    let matrixArr: number[] | undefined;
    let center: [number, number, number] = [0, 0, 0];

    if (!queryId) return { matrixArr, center };

    // Single source of truth: Array of ConnectedPointCloudMetadata
    const metadataList: ConnectedPointCloudMetadata[] = [];

    if (summaryMap) {
        // Collect from direct summaryMap[queryId]
        const summary = summaryMap[queryId];
        if (summary?.connected_pointclouds) {
            metadataList.push(...summary.connected_pointclouds);
        }

        // Collect from all summaries in summaryMap
        for (const currSummary of Object.values(summaryMap)) {
            if (currSummary?.connected_pointclouds) {
                for (const pc of currSummary.connected_pointclouds) {
                    if (pc && !metadataList.some((m) => m.id === pc.id)) {
                        metadataList.push(pc);
                    }
                }
            }
        }
    }

    if (catalog) {
        for (const pc of catalog) {
            if (pc && !metadataList.some((m) => m.id === pc.id)) {
                metadataList.push(pc as ConnectedPointCloudMetadata);
            }
        }
    }

    // 1. Check for exact match by pointcloud ID in ConnectedPointCloudMetadata[]
    const match = metadataList.find((m) => m.id === queryId);
    if (match) {
        if (match.transform_matrix && match.transform_matrix.length === 16) {
            matrixArr = match.transform_matrix;
        }
        if (match.center && Array.isArray(match.center) && match.center.length === 3) {
            center = [Number(match.center[0]), Number(match.center[1]), Number(match.center[2])];
        } else if (match.centerpoint && Array.isArray(match.centerpoint) && match.centerpoint.length === 3) {
            center = [Number(match.centerpoint[0]), Number(match.centerpoint[1]), Number(match.centerpoint[2])];
        }
    }

    // 2. If no exact ID match (e.g. queryId is a query container ID), fallback to first item with valid matrix
    const filteredMetadataList = query
        ? metadataList.filter((m) => isConnectedPointCloudSelected(query, m.id))
        : metadataList;
    const fallbackList = filteredMetadataList.length > 0 ? filteredMetadataList : metadataList;

    if (!matrixArr && fallbackList.length > 0) {
        for (const pc of fallbackList) {
            if (pc.transform_matrix && pc.transform_matrix.length === 16) {
                matrixArr = pc.transform_matrix;
                break;
            }
        }
    }

    // 3. Fallback center from metadataList if center is still [0,0,0]
    if (center[0] === 0 && center[1] === 0 && center[2] === 0 && fallbackList.length > 0) {
        for (const pc of fallbackList) {
            if (pc.center && Array.isArray(pc.center) && pc.center.length === 3) {
                center = [Number(pc.center[0]), Number(pc.center[1]), Number(pc.center[2])];
                break;
            }
            if (pc.centerpoint && Array.isArray(pc.centerpoint) && pc.centerpoint.length === 3) {
                center = [Number(pc.centerpoint[0]), Number(pc.centerpoint[1]), Number(pc.centerpoint[2])];
                break;
            }
        }
    }

    // 4. Final fallback center from summary root
    if (center[0] === 0 && center[1] === 0 && center[2] === 0 && summaryMap?.[queryId]) {
        const summary = summaryMap[queryId];
        if (summary.centerpoint && Array.isArray(summary.centerpoint) && summary.centerpoint.length === 3) {
            center = [Number(summary.centerpoint[0]), Number(summary.centerpoint[1]), Number(summary.centerpoint[2])];
        } else if (summary.center && Array.isArray(summary.center) && summary.center.length === 3) {
            center = [Number(summary.center[0]), Number(summary.center[1]), Number(summary.center[2])];
        }
    }

    return { matrixArr, center };
}
