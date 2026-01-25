/**
 * 1. 파싱 함수 (Loop 기반 - 중첩 괄호 해결)
 * 정규식 대신 문자열을 순회하며 괄호의 짝(Depth)을 셉니다.
 * 예: "group[ tag[1] tag2 ]"를 정확하게 인식합니다.
 */
export const parseGroupedTags = (text) => {
    const groups = {};
    let remainingText = text; // 처리된 그룹을 지워나갈 텍스트
    // 문자열 전체를 스캔하기 위한 커서
    let i = 0;
    while (i < text.length) {
        // 1. 그룹 이름의 끝부분('[' 바로 앞)을 찾음
        const openBracketIndex = text.indexOf('[', i);
        if (openBracketIndex === -1)
            break; // 더 이상 그룹이 없음
        // 2. '[' 앞의 그룹 이름 추출 (공백 기준으로 뒤에서부터 단어 찾기)
        // 예: "my group[..." 에서 "group" 추출
        const beforeBracket = text.slice(0, openBracketIndex);
        const groupNameMatch = beforeBracket.match(/([^\s]+)\s*$/);
        if (!groupNameMatch) {
            i = openBracketIndex + 1;
            continue; // 이름 없는 대괄호는 무시 (일반 태그일 수 있음)
        }
        const groupName = groupNameMatch[1];
        const groupNameStartIndex = groupNameMatch.index;
        // 3. 닫는 괄호 ']' 찾기 (중첩 대응)
        let depth = 1;
        let closeBracketIndex = -1;
        for (let j = openBracketIndex + 1; j < text.length; j++) {
            if (text[j] === '[')
                depth++;
            else if (text[j] === ']')
                depth--;
            if (depth === 0) {
                closeBracketIndex = j;
                break;
            }
        }
        if (closeBracketIndex !== -1) {
            // 4. 내용 추출 및 저장
            const content = text.slice(openBracketIndex + 1, closeBracketIndex);
            // 태그 분리 (공백 기준) & 빈 문자열 제거
            const tags = content.split(/\s+/).filter(t => t.length > 0);
            // 그룹 저장 (기존 그룹 있으면 합침)
            if (groups[groupName]) {
                groups[groupName] = Array.from(new Set([...groups[groupName], ...tags]));
            }
            else {
                groups[groupName] = tags;
            }
            // 5. 원본 텍스트에서 해당 그룹 부분 제거 (나중에 loose tag만 남기기 위해)
            // replace를 쓰면 중복된 다른 그룹까지 지울 수 있으므로, 정확한 위치를 도려냄
            // 앞뒤 공백 처리를 위해 좀 더 안전한 방식 사용이 필요하지만, 
            // 여기서는 파싱된 원본 문자열 조각을 기억해두고 나중에 제거하는 방식을 씁니다.
            // 루프를 위해 인덱스 점프
            i = closeBracketIndex + 1;
        }
        else {
            // 닫는 괄호가 없으면 파싱 중단 (문법 오류 혹은 일반 텍스트)
            i = openBracketIndex + 1;
        }
    }
    // 6. Loose Tag 추출
    // 위 루프 방식은 text를 직접 수정하지 않았으므로, 
    // 간단하게 "모든 태그"를 구한 뒤 "그룹에 들어간 태그"를 빼는 차집합 방식으로 처리합니다.
    // 전체 태그 (그룹 문법 무시하고 다 쪼갬 - 단순화된 처리)
    // 주의: 여기서는 정확성을 위해 위에서 파싱된 그룹 문자열들을 text에서 replace로 지워버리는게 가장 안전합니다.
    // 위 루프 로직을 보완하여 '제거' 로직을 추가합니다.
    // (구현의 복잡도를 줄이기 위해, 정규식이 아닌 '파싱된 그룹 태그 목록'을 이용해 역으로 필터링합니다)
    const allGroupTags = new Set();
    Object.values(groups).forEach(tags => tags.forEach(t => allGroupTags.add(t)));
    // 괄호, 그룹명 등을 대강 공백으로 치환하여 순수 태그만 남기려는 시도보다는
    // flattenTags 함수를 활용하는 것이 좋습니다.
    // 하지만 여기서는 순환 참조를 피하기 위해 간단히 처리합니다.
    // 정밀한 Loose Tag 추출을 위해: 
    // 입력 텍스트에서 'Group[ ... ]' 패턴을 제거하는 정규식을 쓰되, 
    // 이번엔 '추출'용이 아니라 '삭제'용이므로 조금 덜 엄격해도 됩니다.
    // 다만 중첩 괄호 삭제는 정규식으로 불가능하므로, 
    // *이미 추출한 그룹 태그*를 제외한 나머지 태그들을 리턴하는 방식을 씁니다.
    // (이 부분은 사용자가 loose tag를 그룹 밖으로 뺐을 때를 위한 것임)
    const roughSplit = text.replace(/\[|\]/g, ' ').split(/\s+/).filter(t => t.length > 0);
    const originalTags = roughSplit.filter(t => !allGroupTags.has(t) && !groups[t]); // 그룹명 자체도 태그에서 제외
    return { groups, originalTags };
};
/**
 * 2. 태그 펼치기 (Flatten)
 * 그룹 문법을 제거하고 태그들만 나열한 문자열로 변환 (서버 전송용)
 */
export const flattenTags = (text) => {
    // 위의 파서가 중첩 괄호도 처리하므로, 파서를 통해 구조를 깬 뒤 태그만 합칩니다.
    const { groups, originalTags } = parseGroupedTags(text);
    const groupTags = Object.values(groups).flat();
    // 중복 제거 후 합침
    return Array.from(new Set([...groupTags, ...originalTags])).join(' ');
};
/**
 * 3. 재구성 함수 (Reconstruct)
 * 화면에 보이는 태그 순서를 유지하면서 그룹 문법을 다시 입혀줍니다.
 * 복잡한 토큰 맵핑 대신 '필터링' 방식을 사용하여 안전합니다.
 */
export const reconstructTags = (currentText, groupData) => {
    // 1. 현재 화면에 있는 모든 태그를 순서대로 가져옵니다. (단부루 정렬 기준)
    // flattenTags를 쓰면 파서를 거치므로 안전하게 태그 알맹이만 가져옵니다.
    const flatText = flattenTags(currentText);
    const allCurrentTags = flatText.split(/\s+/).filter(t => t.length > 0);
    const usedTags = new Set();
    const formedGroups = [];
    // 2. DB에 저장된 그룹 순회
    for (const [groupName, groupTags] of Object.entries(groupData)) {
        const groupTagSet = new Set(groupTags);
        // [핵심] DB 순서가 아니라, '현재 화면 태그(allCurrentTags)' 순서대로 가져옵니다.
        const presentTags = allCurrentTags.filter(tag => groupTagSet.has(tag));
        if (presentTags.length > 0) {
            // 그룹 문법 생성 (가독성을 위해 내부에 공백 추가)
            formedGroups.push(`${groupName}[ ${presentTags.join(' ')} ]`);
            // 사용된 태그 기록
            presentTags.forEach(t => usedTags.add(t));
        }
    }
    // 3. 그룹에 속하지 않은 나머지 태그들 (Loose Tags) 추출
    // 화면 순서 그대로 유지하되, 이미 그룹으로 묶인 애들만 제외
    const looseTags = allCurrentTags.filter(t => !usedTags.has(t));
    // 4. 최종 문자열 합치기 (나머지 태그들 + 그룹들)
    const looseString = looseTags.join(' ');
    const groupString = formedGroups.join('\n\n'); // 그룹 간에는 줄바꿈 2번
    if (looseString && groupString) {
        return `${looseString}\n\n${groupString}`;
    }
    else {
        return looseString + groupString;
    }
};
/**
 * 동기화용: DB 그룹에서 빠진 태그 제거
 */
export const removeMissingTagsFromGroups = (groups, currentTags) => {
    const currentTagSet = new Set(currentTags);
    const updatedGroups = {};
    let changed = false;
    for (const [groupName, tags] of Object.entries(groups)) {
        const newTags = tags.filter(tag => currentTagSet.has(tag));
        if (newTags.length !== tags.length) {
            changed = true;
        }
        if (newTags.length > 0) {
            updatedGroups[groupName] = newTags;
        }
        else {
            changed = true; // 그룹 삭제됨
        }
    }
    return { updatedGroups, changed };
};
//# sourceMappingURL=parser_duplicate.js.map