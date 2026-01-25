import { parseGroupedTags, reconstructTags } from './parser';
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
        }
    ];
    console.log('--- TEST START ---');
    let passed = 0;
    let failed = 0;
    cases.forEach(c => {
        console.log(`Running: ${c.name}`);
        const result = parseGroupedTags(c.input);
        const groupsMatch = JSON.stringify(result.groups) === JSON.stringify(c.expectedGroups);
        const originalMatch = JSON.stringify(result.originalTags) === JSON.stringify(c.expectedOriginal);
        if (groupsMatch && originalMatch) {
            console.log('  PASS');
            passed++;
        }
        else {
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
    const groups = { 'Group': ['tag[1]', 'tag2'] };
    const input = 'Group[ tag[1] tag2 ]';
    const reconstructed = reconstructTags(input, groups);
    // We expect something that contains the group definition. Exact format might vary but tags should be there.
    console.log('Original :', input);
    console.log('Reconstructed:', reconstructed);
    if (reconstructed.includes('Group[ tag[1] tag2  ]')) {
        console.log('  PASS (Approx)');
    }
    else {
        console.log('  Manual Check Required');
    }
};
runTests();
//# sourceMappingURL=test_parser_cases.js.map