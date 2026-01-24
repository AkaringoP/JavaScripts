/**
 * @fileoverview Conflict Resolution Modal
 * Present when importing data that conflicts with existing local data.
 */
import { DiffResult } from '../../core/import-manager';
export declare class ConflictModal {
    /**
     * Shows the Conflict Resolution Modal.
     * @param diffs - List of conflicting data items.
     * @param onResolve - Callback with the chosen resolution action.
     */
    static show(diffs: DiffResult[], onResolve: (resolution: 'MERGE' | 'OVERWRITE' | 'KEEP') => void): void;
    private static createBtn;
}
