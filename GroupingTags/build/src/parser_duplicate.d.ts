export interface ParsedTags {
    groups: {
        [key: string]: string[];
    };
    originalTags: string[];
}
/**
 * 1. 파싱 함수 (Loop 기반 - 중첩 괄호 해결)
 * 정규식 대신 문자열을 순회하며 괄호의 짝(Depth)을 셉니다.
 * 예: "group[ tag[1] tag2 ]"를 정확하게 인식합니다.
 */
export declare const parseGroupedTags: (text: string) => ParsedTags;
/**
 * 2. 태그 펼치기 (Flatten)
 * 그룹 문법을 제거하고 태그들만 나열한 문자열로 변환 (서버 전송용)
 */
export declare const flattenTags: (text: string) => string;
/**
 * 3. 재구성 함수 (Reconstruct)
 * 화면에 보이는 태그 순서를 유지하면서 그룹 문법을 다시 입혀줍니다.
 * 복잡한 토큰 맵핑 대신 '필터링' 방식을 사용하여 안전합니다.
 */
export declare const reconstructTags: (currentText: string, groupData: {
    [groupName: string]: string[];
}) => string;
/**
 * 동기화용: DB 그룹에서 빠진 태그 제거
 */
export declare const removeMissingTagsFromGroups: (groups: {
    [key: string]: string[];
}, currentTags: string[]) => {
    updatedGroups: {
        [key: string]: string[];
    };
    changed: boolean;
};
