export interface PostTagData {
    postId: number;
    updatedAt: number;
    isImported?: boolean;
    groups: {
        [groupName: string]: string[];
    };
}
