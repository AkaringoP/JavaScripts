import {describe, it, expect} from 'vitest';
import {AnalyticsDataManager} from '../src/core/analytics-data-manager';

const parse = AnalyticsDataManager.parseNewGeneralTags;

describe('parseNewGeneralTags', () => {
  it('returns empty array for body without New General Tags section', () => {
    expect(parse('some random text', 'AkaringoP', '2024-01-01')).toEqual([]);
  });

  it('parses standard DText table row', () => {
    const body = `h5. New General Tags

[table]
[thead][tr][th]Name[/th][th]Updater(s)[/th][th]Versions[/th][th]Post count[/th][/tr][/thead]
[tbody]
[tr]
[td][[gyaru v]] "»":[/posts?tags=gyaru_v] [/td]
[td]"AkaringoP":[/users/701499][/td]
[td]"Versions":[/post_versions?search][/td]
[td]7[/td]
[/tr]
[/tbody]
[/table]

h5. Repopulated Tags`;

    const result = parse(body, 'AkaringoP', '2024-07-31');
    expect(result).toHaveLength(1);
    expect(result[0].tagName).toBe('gyaru_v');
    expect(result[0].reportDate).toBe('2024-07-31');
  });

  it('handles tag names with parentheses', () => {
    const body = `h5. New General Tags
[tr]
[td][[mite (idolmaster)]] "»":[/posts?tags=mite_(idolmaster)] [/td]
[td]"AkaringoP":[/users/701499][/td]
[td]"Versions":[/post_versions][/td]
[td]1[/td]
[/tr]
h5. Other`;

    const result = parse(body, 'AkaringoP', '2026-03-28');
    expect(result).toHaveLength(1);
    expect(result[0].tagName).toBe('mite_(idolmaster)');
  });

  it('filters out tags by other users', () => {
    const body = `h5. New General Tags
[tr]
[td][[some tag]] "»":[/posts] [/td]
[td]"OtherUser":[/users/12345][/td]
[td]"Versions":[/post_versions][/td]
[td]1[/td]
[/tr]
[tr]
[td][[my tag]] "»":[/posts] [/td]
[td]"AkaringoP":[/users/701499][/td]
[td]"Versions":[/post_versions][/td]
[td]3[/td]
[/tr]
h5. Repopulated`;

    const result = parse(body, 'AkaringoP', '2024-01-01');
    expect(result).toHaveLength(1);
    expect(result[0].tagName).toBe('my_tag');
  });

  it('is case-insensitive for username matching', () => {
    const body = `h5. New General Tags
[tr]
[td][[test tag]] "»":[/posts] [/td]
[td]"akaringop":[/users/701499][/td]
[td]"Versions":[/post_versions][/td]
[td]1[/td]
[/tr]
h5. Other`;

    const result = parse(body, 'AkaringoP', '2024-01-01');
    expect(result).toHaveLength(1);
  });

  it('handles multiple updaters (comma separated)', () => {
    const body = `h5. New General Tags
[tr]
[td][[shared tag]] "»":[/posts] [/td]
[td]"OtherUser":[/users/111], "AkaringoP":[/users/701499][/td]
[td]"Versions":[/post_versions][/td]
[td]2[/td]
[/tr]
h5. Other`;

    const result = parse(body, 'AkaringoP', '2024-01-01');
    expect(result).toHaveLength(1);
    expect(result[0].tagName).toBe('shared_tag');
  });

  it('returns empty array when no tags match the user', () => {
    const body = `h5. New General Tags
[tr]
[td][[some tag]] "»":[/posts] [/td]
[td]"SomeoneElse":[/users/999][/td]
[td]"Versions":[/post_versions][/td]
[td]5[/td]
[/tr]
h5. Other`;

    const result = parse(body, 'AkaringoP', '2024-01-01');
    expect(result).toEqual([]);
  });

  it('handles multiple tags by the same user in one report', () => {
    const body = `h5. New General Tags
[tr]
[td][[tag one]] "»":[/posts] [/td]
[td]"AkaringoP":[/users/701499][/td]
[td]"Versions":[/post_versions][/td]
[td]1[/td]
[/tr]
[tr]
[td][[tag two]] "»":[/posts] [/td]
[td]"AkaringoP":[/users/701499][/td]
[td]"Versions":[/post_versions][/td]
[td]3[/td]
[/tr]
h5. Other`;

    const result = parse(body, 'AkaringoP', '2024-01-01');
    expect(result).toHaveLength(2);
    expect(result[0].tagName).toBe('tag_one');
    expect(result[1].tagName).toBe('tag_two');
  });

  it('stops at the next section header', () => {
    const body = `h5. New General Tags
[tr]
[td][[general tag]] "»":[/posts] [/td]
[td]"AkaringoP":[/users/701499][/td]
[td]"Versions":[/post_versions][/td]
[td]1[/td]
[/tr]
h5. Repopulated General Tags
[tr]
[td][[repop tag]] "»":[/posts] [/td]
[td]"AkaringoP":[/users/701499][/td]
[td]"Versions":[/post_versions][/td]
[td]5[/td]
[/tr]`;

    const result = parse(body, 'AkaringoP', '2024-01-01');
    expect(result).toHaveLength(1);
    expect(result[0].tagName).toBe('general_tag');
  });
});
