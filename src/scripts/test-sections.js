import { getMainSections, getSectionTree, getSectionWithChildren } from '../utils/sections.js';

async function testSections() {
  try {
    console.log('Testing sections...');
    
    // Get main sections
    const mainSections = await getMainSections();
    console.log(`Found ${mainSections.length} main sections:`);
    console.table(mainSections.map(s => ({ id: s.id, name: s.name })));
    
    // Get full tree
    const tree = await getSectionTree();
    console.log(`\nFull section tree (${tree.length} top-level sections):`);
    
    // Print tree with nesting
    function printTree(sections, level = 0) {
      const indent = ' '.repeat(level * 2);
      sections.forEach(section => {
        console.log(`${indent}${section.name} (${section.id})`);
        if (section.children.length > 0) {
          printTree(section.children, level + 1);
        }
      });
    }
    
    printTree(tree);
    
    // Test getting a specific section with children
    const economia = await getSectionWithChildren('economia');
    console.log('\nEconomía section with children:');
    console.log(`Section: ${economia.name}`);
    console.log('Children:');
    economia.children.forEach(child => {
      console.log(`- ${child.name} (${child.id})`);
    });
    
    console.log('\nAll tests completed successfully!');
  } catch (error) {
    console.error('Error testing sections:', error);
  }
}

testSections();