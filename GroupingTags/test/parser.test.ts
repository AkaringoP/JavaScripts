/**
 * @fileoverview Unit tests for the parser module.
 * Covers group extraction, nested bracket handling, and tag reconstruction logic.
 */
import {describe, it, expect} from 'vitest';
import {parseGroupedTags, reconstructTags} from '../src/parser';

describe('Parser Logic', () => {
  describe('parseGroupedTags', () => {
    const cases = [
      {
        name: 'Simple Group',
        input: 'Group[ tag1 tag2 ]',
        expectedGroups: {Group: ['tag1', 'tag2']},
        expectedOriginal: [],
      },
      {
        name: 'Nested Brackets inside group',
        input: 'Group[ tag[1] tag2 ]',
        expectedGroups: {Group: ['tag[1]', 'tag2']},
        expectedOriginal: [],
      },
      {
        name: 'Loose tags and group',
        input: 'loose1 Group[ tag1 ] loose2',
        expectedGroups: {Group: ['tag1']},
        expectedOriginal: ['loose1', 'loose2'],
      },
      {
        name: 'Nested Brackets in loose tags',
        input: 'tag[3] Group[ tag4 ]',
        // logic update: 'tag' matches valid group name regex, so it IS parsed as a group.
        expectedGroups: {Group: ['tag4'], tag: ['3']},
        expectedOriginal: [],
      },
      {
        name: 'Multiple Groups',
        input: 'G1[ t1 ] G2[ t2 ]',
        expectedGroups: {G1: ['t1'], G2: ['t2']},
        expectedOriginal: [],
      },
      {
        name: 'Strict Naming (Emoticon check)',
        input: ':[ tag ]',
        expectedGroups: {},
        // logic update: ':[ ' splits to ':[', 'tag', ']'
        expectedOriginal: [':[', 'tag', ']'],
      },
      {
        name: 'Escaped Bracket (Start)',
        input: 'abc\\[n]',
        expectedGroups: {},
        expectedOriginal: ['abc[n]'],
      },
      {
        name: 'Escaped Bracket in Group',
        input: 'Group[ tag\\[1\\] ]',
        expectedGroups: {Group: ['tag[1]']},
        expectedOriginal: [],
      },
      {
        name: 'User Scenario: Mixed Group and Escaped Tag',
        input: 'abc[ tag1 tag2 ] def\\[n] tag3',
        expectedGroups: {abc: ['tag1', 'tag2']},
        expectedOriginal: ['def[n]', 'tag3'],
      },
    ];

    cases.forEach(c => {
      it(c.name, () => {
        const result = parseGroupedTags(c.input);
        expect(result.groups).toEqual(c.expectedGroups);
        expect(result.originalTags).toEqual(c.expectedOriginal);
      });
    });
  });

  describe('reconstructTags', () => {
    it('should reconstruct basic groups', () => {
      const groups = {Group: ['tag[1]', 'tag2']};
      const input = 'Group[ tag[1] tag2 ]';

      // Note: reconstructTags now requires correct ordering logic if implemented
      const reconstructed = reconstructTags(input, groups);

      expect(reconstructed).toContain('Group[');
      expect(reconstructed).toContain('tag[1]');
      expect(reconstructed).toContain('tag2');
    });
    it('should append a trailing space after EVERY group', () => {
      const groups = {g1: ['foo'], g2: ['bar']};
      const input = 'g1[ foo ] g2[ bar ]';
      const result = reconstructTags(input, groups);

      // Expectation: "g1[ foo ] \n\ng2[ bar ] "
      // Check that g1 ends with space before newline
      expect(result).toMatch(/g1\[ foo \] \n\n/);
      // Check that last part ends with space
      expect(result.endsWith(' ')).toBe(true);
    });
  });
});
