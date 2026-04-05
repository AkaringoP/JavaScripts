# Member(Blue) 유저 2태그 제한 호환성 개선

## 배경

Danbooru의 일반 Member(파란색) 계정은 포스트 검색 시 **태그 2개까지만** 사용할 수 있다.
Gold 이상 계정은 이 제한이 없다.

DanbooruInsights는 개발자가 Gold+ 환경에서 개발했기 때문에, 일부 API 쿼리가 3개 이상의 태그를 사용하고 있어 Member 유저에게는 해당 기능이 조용히 실패한다.

## 핵심 규칙: 메타태그는 제한에 포함되지 않음

[포럼 #33823](https://danbooru.donmai.us/forum_topics/33823)에서 확인된 바와 같이, 다음 메타태그는 2태그 제한에 **포함되지 않는다** (무료):

```
user:  rating:  status:  order:  date:  age:  id:  
has:   is:      fav:     ordfav: limit: source:
gentags:  copytags:  chartags:  arttags:
```

실제 태그 이름(예: `1girl`, `commentary`, `translated`)만 제한에 걸린다.

## 현황 분석

### 문제 없는 쿼리 (대부분)

| 기능 | 쿼리 예시 | 실제 태그 수 |
|---|---|---|
| 데이터 동기화 | `user:name order:id id:>N` | 0 |
| Top Posts | `user:name order:score rating:g` | 0 |
| Recent Popular | `user:name order:score is:sfw age:<1w` | 0 |
| Rating 분포 | `user:name rating:g date:>=date` | 0 |
| Status 분포 | `user:name status:active` | 0 |
| 썸네일 fetch | `user:name tagname order:score rating:g` | 1 |
| Copyright/Character 카운트 | `user:name tagname` | 1 |
| Commentary (translated) | `user:name has:commentary commentary` | 2 (한도 내) |
| Commentary (requested) | `user:name has:commentary commentary_request` | 2 (한도 내) |
| TagAnalytics 전체 | `tagname date:range`, `tagname status:x` 등 | 0~2 |
| GrassApp 전체 | `user:name date:range` 등 | 0 |

### 수정이 필요한 쿼리 (4개)

| 기능 | 현재 쿼리 | 태그 수 | 위치 |
|---|---|---|---|
| Gender — Girl | `user:name ~1girl ~2girls ~3girls ~4girls ~5girls ~6+girls` | 6 | `analytics-data-manager.ts` `getGenderDistribution()` |
| Gender — Boy | `user:name ~1boy ~2boys ~3boys ~4boys ~5boys ~6+boys` | 6 | 동일 |
| Gender — Other | `user:name ~1other ~2others ~3others ~4others ~5others ~6+others` | 6 | 동일 |
| Translation 미분류 | `user:name *_text -english_text -translation_request -translated` | 4 | `analytics-data-manager.ts` `getTranslationDistribution()` |

## 수정 방법

### Gender 분포: OR 쿼리 → 개별 쿼리 합산

**현재 코드** (`analytics-data-manager.ts`):
```typescript
{
  name: 'Girl',
  query: `user:${normalizedName} ~1girl ~2girls ~3girls ~4girls ~5girls ~6+girls`,
}
```

**수정 후**:
```typescript
{
  name: 'Girl',
  subQueries: [
    `user:${normalizedName} 1girl`,
    `user:${normalizedName} 2girls`,
    `user:${normalizedName} 3girls`,
    `user:${normalizedName} 4girls`,
    `user:${normalizedName} 5girls`,
    `user:${normalizedName} 6+girls`,
  ],
}
```

각 서브쿼리의 카운트를 병렬로 fetch한 뒤 합산한다.

> **주의**: OR 쿼리(`~`)는 중복 제거된 합집합이지만, 개별 쿼리 합산은 한 포스트에 `1girl`과 `2girls`가 동시에 태그된 경우 중복 카운트될 수 있다. 단, 이 태그들은 상호 배타적으로 운용되므로 실질적 차이는 무시할 수 있다.

### Translation 미분류: 뺄셈으로 계산

**현재 코드**:
```typescript
{
  name: 'Untagged',
  query: `user:${normalizedName} *_text -english_text -translation_request -translated`,
}
```

**수정 후**: 와일드카드 쿼리와 개별 쿼리의 차이로 계산
```typescript
// 1) 전체: user:name *_text (1태그 — 와일드카드도 1태그로 카운트)
// 2) 빼기: user:name english_text (1태그)
// 3) 빼기: user:name translation_request (1태그)
// 4) 빼기: user:name translated (1태그)
// Untagged = (1) - (2) - (3) - (4)
```

4회 API 호출로 분해되지만, 각각 1태그 쿼리이므로 Member에서도 동작한다.

## 설계 결정: 레벨 감지 불필요

유저 레벨을 감지해서 Member/Gold 분기를 만드는 대신, **전 레벨에서 분해 쿼리를 통일**한다.

이유:
- 분해 쿼리는 Gold+ 유저에게도 정상 동작함 (기능적 동등)
- 코드 경로가 하나로 유지되어 테스트/유지보수가 단순함
- API 호출 증가(Gender: 3회 → 18회, Translation: 1회 → 4회)는 기존 `RateLimitedFetch`가 처리 가능한 수준

## 영향 범위

- **수정 파일**: `src/core/analytics-data-manager.ts` 1개
- **수정 메서드**: `getGenderDistribution()`, `getTranslationDistribution()` 2개
- **다른 앱 영향**: 없음 (UserAnalyticsApp 내부 변경만)
- **TagAnalyticsApp**: 수정 불필요 (전 쿼리 2태그 이내)
- **GrassApp**: 수정 불필요 (전 쿼리 메타태그만 사용)

## 완료 후 조치

1. 수정 적용 및 `npm run build` 통과 확인
2. 포럼 게시글 Usage Notes에 다음 항목 추가:
```
* **Account level**
** All features work at every account level including basic Member (Blue).
** No Gold-only search features (3+ tag queries) are used.
```
3. README에 "Works with all account levels" 명시
