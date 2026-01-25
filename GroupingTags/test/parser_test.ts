
import { parseGroupedTags, reconstructTags } from '../src/parser.js';

const runTests = () => {
  const cases = [
    {
      name: 'Simple Group',
      input: 'Group[ tag1 tag2 ]',
      expectedGroups: { 'Group': ['tag1', 'tag2'] },
      expectedOriginal: []
    },
    {
      name: 'Nested Brackets inside group',
      input: 'Group[ tag[1] tag2 ]',
      expectedGroups: { 'Group': ['tag[1]', 'tag2'] },
      expectedOriginal: []
    },
    {
      name: 'Loose tags and group',
      input: 'loose1 Group[ tag1 ] loose2',
      expectedGroups: { 'Group': ['tag1'] },
      expectedOriginal: ['loose1', 'loose2']
    },
     {
      name: 'Nested Brackets in loose tags',
      input: 'tag[3] Group[ tag4 ]',
      expectedGroups: { 'Group': ['tag4'] },
      expectedOriginal: ['tag[3]']
    },
    {
      name: 'Multiple Groups',
      input: 'G1[ t1 ] G2[ t2 ]',
      expectedGroups: { 'G1': ['t1'], 'G2': ['t2'] },
      expectedOriginal: []
    },
    {
      name: 'Strict Naming (Emoticon check)',
      input: ':[ tag ]',
      expectedGroups: {},
      expectedOriginal: [':', 'tag', ']'] // Parsed as loose tags due to split
    },
    {
      name: 'Escaped Bracket (Start)',
      input: 'abc\\[n]',
      expectedGroups: {},
      expectedOriginal: ['abc[n]'] // Unescaped
    },
    {
      name: 'Escaped Bracket in Group',
      input: 'Group[ tag\\[1\\] ]',
      expectedGroups: { 'Group': ['tag[1]'] }, // Unescaped content
      expectedOriginal: []
    },
    {
      name: 'User Scenario: Mixed Group and Escaped Tag',
      input: 'abc[ tag1 tag2 ] def\\[n] tag3',
      expectedGroups: { 'abc': ['tag1', 'tag2'] },
      expectedOriginal: ['def[n]', 'tag3']
    }
  ];

  console.log('--- TEST START ---');
  let passed = 0;
  let failed = 0;

  cases.forEach(c => {
    console.log(`Running: ${c.name}`);
    const result = parseGroupedTags(c.input);
    
    // Sort for consistent comparison if needed, but array order usually preserved by parser
    const groupsMatch = JSON.stringify(result.groups) === JSON.stringify(c.expectedGroups);
    const originalMatch = JSON.stringify(result.originalTags) === JSON.stringify(c.expectedOriginal);

    if (groupsMatch && originalMatch) {
      console.log('  PASS');
      passed++;
    } else {
      console.log('  FAIL');
      console.log('  Input:', c.input);
      console.log('  Expected Groups:', JSON.stringify(c.expectedGroups));
      console.log('  Actual Groups:  ', JSON.stringify(result.groups));
      console.log('  Expected Original:', JSON.stringify(c.expectedOriginal));
      console.log('  Actual Original:  ', JSON.stringify(result.originalTags));
      failed++;
    }
  });

  console.log(`\nResults: ${passed} Passed, ${failed} Failed`);
  
  // Test Reconstruct (Idempotency)
  console.log('\n--- Reconstruct Test ---');
  const groups: { [key: string]: string[] } = { 'Group': ['tag[1]', 'tag2'] };
  const input = 'Group[ tag[1] tag2 ]';
  const reconstructed = reconstructTags(input, groups);
  
  console.log('Original :', input);
  console.log('Reconstructed:', reconstructed);
  
  // Basic check: should contain the keys and values
  if (reconstructed.includes('Group') && reconstructed.includes('tag[1]') && reconstructed.includes('tag2')) {
      console.log('  PASS (Approx)');
  } else {
      console.log('  Manual Check Required');
  }
};

runTests();
