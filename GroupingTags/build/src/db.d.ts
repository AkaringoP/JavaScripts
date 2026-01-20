import { PostTagData } from './types';
export declare const openDB: () => Promise<IDBDatabase>;
export declare const savePostTagData: (data: PostTagData) => Promise<void>;
export declare const getPostTagData: (postId: number) => Promise<PostTagData | undefined>;
export declare const deletePostTagData: (postId: number) => Promise<void>;
