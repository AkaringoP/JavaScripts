export interface PostTagData {
    postId: number;           // Primary Key
    updated_at: number;       // Unix Timestamp
    is_imported?: boolean;    // true: external data, false/undefined: local data
    groups: {
        [groupName: string]: string[];
    };
}
