import { Romcal } from 'romcal';
import { UnitedStates_En } from '@romcal/calendar.united-states';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// List of computed properties we want to extract from liturgical day instances
const COMPUTED_PROPERTIES = [
  'name',
  'seasonNames',
  'colorNames',
  'rankName',
  'proper',
  'common',
  'prioritized',
  'key',
  'precedence',
  'definition'
];

async function exploreRomcal() {
  console.log('Exploring romcal computed properties...');
  
  // Initialize romcal
  const romcal = new Romcal({
    scope: 'liturgical',
    locale: 'en',
    localizedCalendar: UnitedStates_En,
    epiphanyOnSunday: true,
    corpusChristiOnSunday: true,
    ascensionOnSunday: false,
  });
  
  // Get calendar for current year to access actual day instances with computed properties
  const currentYear = new Date().getFullYear();
  console.log(`Generating calendar for ${currentYear}...`);
  const calendar = await romcal.generateCalendar(currentYear);
  
  // Get all liturgical day definitions
  console.log('Getting liturgical day definitions...');
  const definitions = await romcal.getAllDefinitions();
  console.log('Retrieved', Object.keys(definitions).length, 'liturgical day definitions');
  
  // Create output directory if it doesn't exist
  const outputDir = path.join(__dirname, '..', 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }
  
  // Extract actual liturgical day instances with computed properties from the calendar
  const allDays = [];
  for (const [date, days] of Object.entries(calendar)) {
    if (Array.isArray(days) && days.length > 0) {
      for (const day of days) {
        // Extract computed properties from the day instance
        const extractedDay = {
          date,
          id: day.id,
          key: day.key,
        };
        
        // Extract computed properties
        for (const prop of COMPUTED_PROPERTIES) {
          if (prop in day) {
            extractedDay[prop] = day[prop];
          }
        }
        
        allDays.push(extractedDay);
      }
    }
  }
  
  console.log(`Extracted ${allDays.length} liturgical day instances with computed properties`);
  
  // Output the calendar data with computed properties
  const computedPropsPath = path.join(outputDir, 'romcal_computed_props.json');
  fs.writeFileSync(computedPropsPath, JSON.stringify(allDays, null, 2));
  console.log(`Liturgical days with computed properties written to ${computedPropsPath}`);
  
  // Create a mapping from definition IDs to computed properties
  const definitionToComputedProps = {};
  for (const day of allDays) {
    if (day.id) {
      // Store the day with the richest computed properties for each ID
      if (!definitionToComputedProps[day.id] || 
          Object.keys(definitionToComputedProps[day.id]).length < Object.keys(day).length) {
        definitionToComputedProps[day.id] = day;
      }
    }
  }
  
  // Create an enhanced simplified list with computed properties
  const enhancedList = Object.entries(definitions).map(([key, def]) => {
    const id = def.id || key;
    const computedProps = definitionToComputedProps[id] || {};
    
    return {
      id,
      name: computedProps.name || def.name || 'Unknown',
      season: computedProps.seasonNames?.[0] || def.season || 'Unknown',
      seasons: computedProps.seasonNames || [],
      colors: computedProps.colorNames || [],
      rank: computedProps.rankName || def.rank?.name || 'Unknown',
      date: computedProps.date || null,
      prioritized: computedProps.prioritized || false,
      precedence: computedProps.precedence || null
    };
  });
  
  // Sort by ID for easier browsing
  enhancedList.sort((a, b) => a.id.localeCompare(b.id));
  
  const enhancedPath = path.join(outputDir, 'romcal_enhanced.json');
  fs.writeFileSync(enhancedPath, JSON.stringify(enhancedList, null, 2));
  console.log(`Enhanced list with computed properties written to ${enhancedPath}`);
  
  // Search for specific seasons to show computed properties
  console.log('\nSample liturgical days with computed properties:');
  const seasonExamples = {
    'Advent': allDays.find(day => day.seasonNames?.includes('Advent')),
    'Christmas': allDays.find(day => day.seasonNames?.includes('Christmas Time')),
    'Lent': allDays.find(day => day.seasonNames?.includes('Lent')),
    'Easter': allDays.find(day => day.seasonNames?.includes('Easter Time')),
    'Ordinary Time': allDays.find(day => day.seasonNames?.includes('Ordinary Time')),
  };
  
  for (const [season, example] of Object.entries(seasonExamples)) {
    if (example) {
      console.log(`${season} example:`);
      console.log(`  Date: ${example.date}`);
      console.log(`  Name: ${example.name}`);
      console.log(`  Season Names: ${example.seasonNames?.join(', ')}`);
      console.log(`  Color Names: ${example.colorNames?.join(', ')}`);
      console.log(`  Rank: ${example.rankName}`);
      console.log('');
    }
  }
}

exploreRomcal().catch(error => {
  console.error('Error:', error);
});