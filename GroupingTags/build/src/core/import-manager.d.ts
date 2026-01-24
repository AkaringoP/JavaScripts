import { PostTagData } from '../types';
export type DiffStatus = 'NEW' | 'SAME' | 'CONFLICT';
export interface DiffResult {
    postId: string;
    status: DiffStatus;
    local?: PostTagData;
    remote: PostTagData;
}
export declare class ImportManager {
    static fetchExternalGist(targetGistId: string): Promise<Record<string, PostTagData>>;
    static compareWithLocal(localData: Record<string, PostTagData>, remoteData: Record<string, PostTagData>): DiffResult[];
    private static isDeepEqual;
}
export declare function mergeGroups(localGroups: Record<string, string[]>, remoteGroups: Record<string, string[]>): Record<string, string[]>;
