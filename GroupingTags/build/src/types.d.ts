export interface PostTagData {
    postId: number;
    updated_at: number;
    is_imported?: boolean;
    groups: {
        [groupName: string]: string[];
    };
}
