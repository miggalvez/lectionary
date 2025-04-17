import { Romcal } from 'romcal';
import { UnitedStates_En } from '@romcal/calendar.united-states';

async function main() {
  // Initialize romcal
  const romcal = new Romcal({
    scope: 'liturgical',
    locale: 'en',
    localizedCalendar: UnitedStates_En,
    epiphanyOnSunday: true,
    corpusChristiOnSunday: true,
    ascensionOnSunday: false,
  });
  
  // Get all liturgical day definitions
  console.log('Getting liturgical day definitions...');
  const definitions = await romcal.getAllDefinitions();
  
  // Search for some key feasts and show their official names
  const searchTerms = [
    'advent', 
    'christmas', 
    'holy family', 
    'epiphany', 
    'baptism',
    'ordinary time',
    'lent',
    'easter',
    'pentecost',
    'mary'
  ];
  
  for (const term of searchTerms) {
    console.log(`\n=== Searching for '${term}' ===`);
    const matches = Object.values(definitions).filter(def => {
      return def.id && (
        def.id.toLowerCase().includes(term.toLowerCase()) ||
        (def.name && def.name.toLowerCase().includes(term.toLowerCase()))
      );
    }).slice(0, 5); // Show up to 5 matches
    
    if (matches.length > 0) {
      matches.forEach(match => {
        console.log(`ID: ${match.id}`);
        console.log(`Name: ${match.name}`);
        console.log('---');
      });
    } else {
      console.log('No matches found');
    }
  }
}

main().catch(console.error);