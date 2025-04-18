import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync'; // Replace cheerio with csv-parse
import { bcv_parser } from "bible-passage-reference-parser/esm/bcv_parser.js";
import * as lang from "bible-passage-reference-parser/esm/lang/full.js";
import { Romcal } from 'romcal';
import { UnitedStates_En } from '@romcal/calendar.united-states';

// Constants for accessing computed properties from romcal
const COMPUTED_PROPERTIES = [
  'name', 
  'seasonNames', 
  'colorNames', 
  'rankName',
  'precedence'
];

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Helper function to normalize date to MM-DD format
function normalizeDate(date) {
    if (!date) return null;
    // Remove any non-numeric characters and get last 4 digits (MMDD)
    const cleaned = date.replace(/[^0-9]/g, '').slice(-4);
    // Insert hyphen between MM and DD
    return cleaned.slice(0, 2) + '-' + cleaned.slice(2);
}

// Initialize the Bible reference parser
const bcv = new bcv_parser(lang);
const translation = "nab"; // New American Bible
bcv.include_apocrypha(true); // Catholic canon
bcv.set_options({ 
    "book_alone_strategy": "full", 
    "book_range_strategy": "include", 
    "versification_system": "nab",
    "sequence_combination_strategy": "separate", // Handle sequences like Lk 3:4+6
    "split_sequence_chars": "+," // Define characters that split sequences
});

function processReference(reference, isGospel = false, cycle = null) {
    if (!reference) return [];
    
    // Handle specific case for no biblical reference
    if (reference.trim().toLowerCase() === '(no bibl. ref.)') {
        return [{
            referenceOsis: null,
            referenceStandard: null,
            note: 'no biblical reference'
        }];
    }
    
    // Special case for Palm Sunday with multiple cycle options
    if (reference.includes('A:') && reference.includes('B:') && reference.includes('C:')) {
        // This is a Palm Sunday Gospel with options for each cycle
        const cycleMatch = reference.match(new RegExp(`${cycle}:\\s*([^\\n]+)(?:\\n|$)`));
        if (cycleMatch) {
            // Process just the reference for this specific cycle
            return processReference(cycleMatch[1], isGospel);
        }
        
        return []; // No matching cycle found
    }
    
    const readingOptions = [];
    
    // Handle Gospel titles: "Reference – Title"
    let gospelTitle = null;
    if (isGospel && reference.includes('–')) {
        const parts = reference.split('–').map(p => p.trim());
        reference = parts[0];
        gospelTitle = parts[1];
    }
    
    // Remove (diff) and (new) annotations entirely from the reference
    reference = reference.replace(/\s*\(diff\)|\s*\(new\)/g, '');
    
    // Split by "or" first to handle alternative readings
    const options = reference.split(/\s+or\s+/i);
    
    // Find the book name from the first reference to use for any partial references
    let bookName = '';
    const bookMatch = options[0].match(/^(\d*\s*[A-Za-z]+)/);
    if (bookMatch) {
        bookName = bookMatch[1];
    }
    
    for (let i = 0; i < options.length; i++) {
        let option = options[i];
        
        // Fix partial references by adding book name if missing
        // This handles cases like "Matt 1:1-25 or 1:18-25"
        if (i > 0 && /^\d/.test(option.trim()) && bookName) {
            option = bookName + ' ' + option;
        }
        
        // Check if this is an optional reading (marked with "opt:")
        const isOptional = option.trim().toLowerCase().startsWith('opt:');
        
        // Extract any citation in parentheses before cleaning
        let citation = null;
        const citationMatch = option.match(/\(cited in ([^)]+)\)/i);
        if (citationMatch) {
            citation = citationMatch[1]; // Store the citation text
        }
        
        // Check for "cf." reference
        const isCf = option.trim().toLowerCase().startsWith('cf.');
        let cleanOption = option;
        if (isCf) {
            // Remove the "cf." prefix but remember it was there
            cleanOption = option.replace(/^cf\.\s*/i, '');
        }
        
        // Replace "+" with "," for proper OSIS reference parsing
        let cleanReference = cleanOption
            .replace(/^opt:\s*/i, '') // Remove "opt:" prefix
            .replace(/(\d+)\+(\d+)/g, '$1,$2') // Replace "+" between numbers with ","
            .replace(/[‒–—―]/g, '-') // Replace any kind of dash with regular hyphen
            .replace(/\s*-\s*Vg.*|\(new\)|\(diff\)/g, '') // Strip annotations like "- Vg", "(new)" or "(diff)"
            .replace(/\s*,\s*/g, ', ') // Normalize spaces around commas
            .replace(/(\d+)\s*:\s*(\d+)/g, '$1:$2') // Clean up spaces around colons
            .replace(/\s+/g, ' ') // Normalize multiple spaces
            .replace(/[^\x00-\x7F]/g, '-') // Replace any non-ASCII char with regular hyphen
            .trim();

        if (!cleanReference) continue;
        
        try {
            const parsingResult = bcv.parse(cleanReference);
            const osis = parsingResult.osis();
            
            if (osis) {
                // Create the standardReference with "+" replaced with ","
                const standardReference = cleanOption
                    .replace(/^opt:\s*/i, '') // Remove "opt:" prefix
                    .replace(/(\d+)\+(\d+)/g, '$1,$2') // Replace "+" between numbers with ","
                    .replace(/[‒–—―]/g, '-') // Replace any kind of dash with regular hyphen
                    .replace(/\s*-\s*Vg.*|\(new\)|\(diff\)/g, '') // Strip annotations
                    .replace(/\s*,\s*/g, ', ') // Normalize spaces around commas
                    .replace(/(\d+)\s*:\s*(\d+)/g, '$1:$2') // Clean up spaces around colons
                    .replace(/\s+/g, ' ') // Normalize multiple spaces
                    .replace(/[^\x00-\x7F]/g, '-') // Replace any non-ASCII char with hyphen
                    .trim();
                
                // Determine note content based on various attributes
                let notes = [];
                
                // Add options for different reading types
                if (isOptional) {
                    notes.push('optional');
                }
                
                if (isCf) {
                    notes.push('cf.');
                }
                
                if (/\(short form\)/i.test(option)) {
                    notes.push('short form');
                } else if (options.length > 1) {
                    notes.push('alternative/option');
                }
                
                // Add citation information to the note if present
                if (citation) {
                    notes.push(`cited in ${citation}`);
                }
                
                // Add Gospel title if present
                if (gospelTitle) {
                    notes.push(gospelTitle);
                }
                
                // Combine all notes with semicolons
                const note = notes.length > 0 ? notes.join('; ') : null;
                
                readingOptions.push({
                    referenceOsis: osis, // OSIS format as required by schema
                    referenceStandard: standardReference, // Standard reference with "+" replaced with ","
                    note: note
                });
            } else {
                console.warn(`Could not generate OSIS for reference: ${cleanReference} (Original: ${reference})`);
            }
        } catch (error) {
            console.error(`Error processing reference: ${cleanReference} (Original: ${reference})`, error);
        }
    }
    
    return readingOptions;
}

// Function to extract readings from CSV file instead of HTML
function extractReadingsFromCSV(csvContent) {
    const records = parse(csvContent, {
        columns: true, // Use the first row as header
        skip_empty_lines: true,
        trim: true
    });
    
    const readings = { A: [], B: [], C: [], I: [], II: [] }; // Initialize structure for Sunday cycles and weekday cycles
    
    for (const record of records) {
        // Handle different CSV column names
        const columnNames = Object.keys(record);
        const dayDescColumn = columnNames.find(name => 
            name.includes('Sunday') || 
            name.includes('Feast') || 
            name.includes('Day')) || 'Sunday' || 'Day';
            
        const firstReadingRef = record['First Reading'];
        const psalmRef = record['Responsorial Psalm'];
        const secondReadingRef = record['Second Reading']; // May be undefined for weekdays
        
        // Check for different variations of the Gospel Acclamation column
        const alleluiaRef = record[columnNames.find(name => 
            name.includes('Alleluia') || 
            name.includes('Verse before') ||
            name.includes('Gospel Acclamation')
        )] || record['Verse before the Gospel'] || record['Alleluia'] || record['Alleluia Verse'];
        
        const gospelRef = record['Gospel'];
        
        const dayDescription = record[dayDescColumn];
        if (!dayDescription) continue; // Skip rows without a day description
        
        // Check if this is a weekday (contains a day of week like Mon, Tues, etc.)
        const isWeekday = /\b(Mon|Tues|Wed|Thurs|Fri|Sat)\b/i.test(dayDescription);
        
        // Check if this is Palm Sunday (special case)
        const isPalmSunday = /palm\s+sunday/i.test(dayDescription);
        
        // Determine if this is a special feast or a regular Sunday
        const isRegularSunday = /(\d+)(?:st|nd|rd|th)\s+Sunday\s+(?:in|of)\s+(\w+)\s+[–-]\s+([ABC])/i.test(dayDescription);
        
        if (isWeekday) {
            // Handle weekday readings
            // Match both formats: "2nd Week of Easter - Mon" and "Octave of Easter - Mon"
            const weekdayMatch = dayDescription.match(/(?:(?:(\d+)(?:st|nd|rd|th))?\s+(?:Week|Octave)\s+of\s+(\w+)|Octave\s+of\s+(\w+))\s+-\s+(\w+)/i);
            if (!weekdayMatch) {
                console.warn(`Could not parse weekday description: ${dayDescription}`);
                continue;
            }
            
            // If we matched the "Octave of Easter - Day" pattern, then index 3 has the season and index 4 has the day
            // Otherwise, index 1 has the week number, index 2 has the season, and index 4 has the day
            const isOctave = !weekdayMatch[1] || weekdayMatch[3];
            const weekNumber = isOctave ? 1 : parseInt(weekdayMatch[1]); // Octave is week 1
            const season = (weekdayMatch[3] || weekdayMatch[2]).toUpperCase(); // e.g., "EASTER"
            const dayOfWeek = weekdayMatch[4]; // e.g., "Mon"
            
            // Determine day number within week (1 = Monday, 6 = Saturday)
            const dayMapping = {
                'Mon': 1, 'Tues': 2, 'Wed': 3, 'Thurs': 4, 'Fri': 5, 'Sat': 6, 'Sun': 0
            };
            
            const dayNumber = dayMapping[dayOfWeek] || 0;
            
            // Map day of week to full name
            const fullDayNames = {
                'Mon': 'Monday', 'Tues': 'Tuesday', 'Wed': 'Wednesday', 
                'Thurs': 'Thursday', 'Fri': 'Friday', 'Sat': 'Saturday', 'Sun': 'Sunday'
            };
            
            const fullDayName = fullDayNames[dayOfWeek] || dayOfWeek;
            
            // Create reading info for both weekday cycles
            for (const cycle of ['I', 'II']) {
                const feastName = isOctave 
                    ? `${fullDayName} within the Octave of Easter` 
                    : `${fullDayName} of the ${getOrdinalSuffix(weekNumber)} Week of Easter`;
                
                let readingInfo = {
                    sourceName: dayDescription,
                    feastName: feastName,
                    cycle: cycle, // Weekday cycles are I and II
                    weekNumber: weekNumber,
                    season: season,
                    dayOfWeek: fullDayName,
                    dayInWeek: dayNumber,
                    isFeast: isOctave, // Days in the Octave are special
                    feastIdentifier: isOctave ? `easter_octave_${dayOfWeek.toLowerCase()}` : null,
                    readings: {
                        first_reading: processReference(firstReadingRef),
                        responsorial_psalm: processReference(psalmRef),
                        // No second reading for weekdays
                        gospel_acclamation: processReference(alleluiaRef),
                        gospel: processReference(gospelRef, true)
                    }
                };
                
                // Add the reading data to the appropriate weekday cycle
                readings[cycle].push(readingInfo);
            }
        } else if (isRegularSunday || isPalmSunday) {
            // Handle regular Sundays and Palm Sunday
            const descMatch = dayDescription.match(/(?:(\d+)(?:st|nd|rd|th)\s+Sunday\s+(?:in|of)\s+(\w+)|(.+?))\s+[–-]\s+([ABC])/i);
            if (!descMatch) {
                console.warn(`Could not parse Sunday description: ${dayDescription}`);
                continue;
            }
            
            const cycle = descMatch[4]; // The cycle is always in the last capture group
            let weekNumber = null;
            let seasonName = '';
            
            if (isPalmSunday) {
                weekNumber = 6; // Palm Sunday is considered the 6th Sunday of Lent
                seasonName = 'LENT';
            } else {
                weekNumber = parseInt(descMatch[1]);
                seasonName = descMatch[2].toUpperCase(); // e.g., ADVENT
            }
            
            // Basic validation
            if (!cycle || !['A', 'B', 'C'].includes(cycle)) {
                console.warn(`Invalid or missing cycle in: ${dayDescription}`);
                continue;
            }
            
            // Create object to store information about this reading
            let feastName = '';
            if (isPalmSunday) {
                feastName = 'Palm Sunday of the Passion of the Lord';
            } else {
                feastName = `${getOrdinalSuffix(weekNumber)} Sunday of ${seasonName}`;
            }
            
            let readingInfo = {
                sourceName: dayDescription, // Keep original name for matching/debugging
                feastName: feastName,
                cycle: cycle,
                weekNumber: weekNumber,
                season: seasonName,
                dayOfWeek: 'Sunday',
                isFeast: isPalmSunday, // Palm Sunday is a special feast
                feastIdentifier: isPalmSunday ? 'palm_sunday' : null,
                readings: {
                    first_reading: isPalmSunday && firstReadingRef === 'x' ? [] : processReference(firstReadingRef),
                    responsorial_psalm: isPalmSunday && psalmRef === 'x' ? [] : processReference(psalmRef),
                    second_reading: isPalmSunday && secondReadingRef === 'x' ? [] : processReference(secondReadingRef),
                    gospel_acclamation: isPalmSunday && alleluiaRef === 'x' ? [] : processReference(alleluiaRef),
                    gospel: processReference(gospelRef, true, cycle)
                }
            };
            
            // Add the reading data to the appropriate cycle
            readings[cycle].push(readingInfo);
        } else {
            // Handle special feasts and solemnities (e.g., "Christmas: At the Vigil Mass - ABC")
            const feastMatch = dayDescription.match(/([^-]+)\s*-\s*([ABC]+)/i);
            if (!feastMatch) {
                console.warn(`Could not parse feast description: ${dayDescription}`);
                continue;
            }
            
            const [, feastName, cyclesStr] = feastMatch;
            const cycles = cyclesStr.split('').filter(c => ['A', 'B', 'C'].includes(c));
            
            // Determine season based on feast name
            let season = '';
            let feastIdentifier = '';
            
            if (feastName.toLowerCase().includes('christmas')) {
                season = 'CHRISTMAS';
                feastIdentifier = feastName.trim().toLowerCase()
                    .replace(/\s+/g, '_')
                    .replace(/[:,']/g, '');
            } else if (feastName.toLowerCase().includes('holy family')) {
                season = 'CHRISTMAS';
                feastIdentifier = 'holy_family';
            } else if (feastName.toLowerCase().includes('mary, the mother of god')) {
                season = 'CHRISTMAS';
                feastIdentifier = 'mary_mother_of_god';
            } else if (feastName.toLowerCase().includes('epiphany')) {
                season = 'CHRISTMAS';
                feastIdentifier = 'epiphany';
            } else if (feastName.toLowerCase().includes('baptism')) {
                season = 'ORDINARY';
                feastIdentifier = 'baptism_of_the_lord';
            } else {
                season = 'SPECIAL';
                feastIdentifier = feastName.trim().toLowerCase()
                    .replace(/\s+/g, '_')
                    .replace(/[:,']/g, '');
            }
            
            // Create reading objects for each applicable cycle
            for (const cycle of cycles) {
                const readingInfo = {
                    sourceName: dayDescription,
                    feastName: feastName.trim(),
                    cycle: cycle,
                    weekNumber: null,
                    season: season,
                    dayOfWeek: 'Sunday', // Most of these special feasts are on Sundays
                    isFeast: true,
                    feastIdentifier: feastIdentifier,
                    readings: {
                        first_reading: processReference(firstReadingRef),
                        responsorial_psalm: processReference(psalmRef),
                        second_reading: processReference(secondReadingRef),
                        gospel_acclamation: processReference(alleluiaRef),
                        gospel: processReference(gospelRef, true, cycle)
                    }
                };
                
                readings[cycle].push(readingInfo);
            }
        }
    }
    
    return readings;
}

// Function to get ordinal suffix
function getOrdinalSuffix(num) {
    const j = num % 10;
    const k = num % 100;
    if (j === 1 && k !== 11) return num + "st";
    if (j === 2 && k !== 12) return num + "nd";
    if (j === 3 && k !== 13) return num + "rd";
    return num + "th";
}

// Helper function to find matching day definition from romcal definitions
function findMatchingDefinition(definitions, season, weekNumber, computedPropsMap) {
    console.log(`Looking for definition match:`, { season, weekNumber });
    
    // Filter definitions for the specific season and week
    const matchingDefinitions = Object.values(definitions).filter(def => {
        // Check if this is a Sunday in the correct season and week
        return def.id && 
               def.id.includes('_sunday') && 
               def.id.includes(`${season.toLowerCase()}_${weekNumber}_`) && 
               !def.id.includes('ord_'); // Avoid matching Ordinary Time if looking for another season
    });
    
    if (matchingDefinitions.length > 0) {
        const match = matchingDefinitions[0];
        // Get computed properties if available
        const computedProps = computedPropsMap?.get(match.id) || {};
        
        console.log(`Found matching definition:`, {
            id: match.id,
            name: computedProps.name || match.name,
            seasonNames: computedProps.seasonNames,
            colorNames: computedProps.colorNames
        });
        
        // Return the definition enhanced with computed properties
        return {
            ...match,
            name: computedProps.name || match.name,
            seasonNames: computedProps.seasonNames || [],
            colorNames: computedProps.colorNames || [],
            rankName: computedProps.rankName
        };
    }
    
    console.log('No matching definition found');
    return null;
}

// Function to list romcal definitions matching a pattern with more detailed information
function listRomcalFeasts(definitions, pattern, computedPropsMap) {
    console.log(`Looking for romcal feasts matching pattern: ${pattern}`);
    
    const matches = Object.values(definitions).filter(def => {
        return def.id && (
            def.id.toLowerCase().includes(pattern.toLowerCase()) ||
            (def.name && def.name.toLowerCase().includes(pattern.toLowerCase()))
        );
    });
    
    if (matches.length > 0) {
        console.log(`Found ${matches.length} matching romcal definitions:`);
        matches.forEach(match => {
            // Get computed properties if available
            const computedProps = computedPropsMap?.get(match.id) || {};
            
            console.log(`- ID: ${match.id}`);
            console.log(`  Name: ${computedProps.name || match.name}`);
            console.log(`  Season Names: ${computedProps.seasonNames?.join(', ') || 'undefined'}`);
            console.log(`  Color Names: ${computedProps.colorNames?.join(', ') || 'undefined'}`);
            console.log(`  Rank: ${computedProps.rankName || match.rank?.name || 'undefined'}`);
            if (match.date) {
                console.log(`  Date: ${match.date}`);
            }
            console.log(''); // Empty line for better readability
        });
    } else {
        console.log(`No romcal definitions found matching pattern: ${pattern}`);
    }
    
    return matches;
}

// Helper function to find feast definition from romcal
function findFeastDefinition(definitions, feastIdentifier, computedPropertiesMap) {
    console.log(`Looking for feast definition match:`, { feastIdentifier });
    
    // Build a mapping of common feast identifiers to romcal keys
    const feastMappings = {
        'christmas_at_the_vigil_mass': 'nativity',
        'christmas_mass_during_the_night': 'nativity',
        'christmas_mass_at_dawn': 'nativity',
        'christmas_mass_during_the_day': 'nativity',
        'holy_family': 'holy_family_of_jesus_mary_and_joseph',
        'mary_mother_of_god': 'mary_mother_of_god',
        'epiphany': 'epiphany',
        'baptism_of_the_lord': 'baptism_of_the_lord',
        'palm_sunday': 'palm_sunday_of_the_passion_of_the_lord',
        'easter_octave_mon': 'easter_monday',
        'easter_octave_tues': 'easter_tuesday',
        'easter_octave_wed': 'easter_wednesday',
        'easter_octave_thurs': 'easter_thursday',
        'easter_octave_fri': 'easter_friday',
        'easter_octave_sat': 'easter_saturday'
    };
    
    // Check if we have a direct mapping
    const romcalKey = feastMappings[feastIdentifier];
    if (!romcalKey) return null;
    
    // Find the definition by the mapped key
    const matchingDefinitions = Object.values(definitions).filter(def => {
        return def.id && def.id.includes(romcalKey);
    });
    
    if (matchingDefinitions.length > 0) {
        const match = matchingDefinitions[0];
        const computedProps = computedPropertiesMap?.get(match.id) || {};
        
        console.log(`Found feast definition:`, {
            id: match.id,
            name: computedProps.name || match.name,
            seasonNames: computedProps.seasonNames,
            colorNames: computedProps.colorNames,
            rankName: computedProps.rankName
        });
        
        // Enhance the definition with computed properties
        return {
            ...match,
            name: computedProps.name || match.name,
            seasonNames: computedProps.seasonNames || [],
            colorNames: computedProps.colorNames || [],
            rankName: computedProps.rankName
        };
    }
    
    console.log('No feast definition found');
    return null;
}

/**
 * Determines the liturgical season based on the romcal ID or name
 * @param {string} id - The romcal ID of the liturgical day
 * @param {string} name - The name of the liturgical day
 * @returns {string} - The liturgical season
 */
function determineSeason(id, name) {
    // Default season is null if we can't determine it
    if (!id && !name) return null;
    
    // Convert inputs to lowercase for case-insensitive matching
    const idLower = id ? id.toLowerCase() : '';
    const nameLower = name ? name.toLowerCase() : '';

    // Match Advent season
    if (idLower.includes('advent') || nameLower.includes('advent')) {
        return 'ADVENT';
    }
    
    // Match Christmas season
    if (
        idLower.includes('christmas') || 
        idLower.includes('nativity') ||
        idLower.includes('holy_family') ||
        idLower.includes('mary_mother_of_god') ||
        idLower.includes('epiphany') ||
        idLower.includes('baptism_of_the_lord') ||
        nameLower.includes('christmas') ||
        nameLower.includes('nativity') ||
        nameLower.includes('holy family') ||
        nameLower.includes('mary, mother of god') ||
        nameLower.includes('epiphany') ||
        nameLower.includes('baptism of the lord')
    ) {
        return 'CHRISTMAS';
    }
    
    // Match Lent season
    if (
        idLower.includes('lent') ||
        idLower.includes('palm_sunday') ||
        nameLower.includes('lent') ||
        nameLower.includes('palm sunday')
    ) {
        return 'LENT';
    }
    
    // Match Easter season
    if (
        idLower.includes('easter') ||
        idLower.includes('pentecost') ||
        nameLower.includes('easter') ||
        nameLower.includes('pentecost') ||
        nameLower.includes('octave')
    ) {
        return 'EASTER';
    }
    
    // Match Ordinary Time
    if (
        idLower.includes('ordinary') ||
        nameLower.includes('ordinary time')
    ) {
        return 'ORDINARY';
    }
    
    // If we can't determine the season from the ID or name, return null
    return null;
}

function normalizeRank(rank) {
    if (!rank) return null;
    
    // Map romcal rank values to schema-compliant rank values
    const rankMapping = {
        "solemnity": "Solemnity",
        "feast": "Feast",
        "memorial": "Memorial",
        "optional memorial": "Optional Memorial",
        "sunday": "Sunday",
        "weekday": "Feria",
        "Feast": "Feast",
        "Solemnity": "Solemnity",
        "Memorial": "Memorial",
        "Optional Memorial": "Optional Memorial",
        "Sunday": "Sunday",
        "Weekday": "Feria"
    };
    
    return rankMapping[rank] || null;
}

function normalizeMassType(massType) {
    // Normalize mass type names to conform to schema enum values (lowercase)
    if (!massType) return null;
    
    const massTypeMapping = {
        "Vigil Mass": "vigil",
        "Mass during the Night": "night",
        "Mass at Dawn": "dawn",
        "Mass during the Day": "day"
    };
    
    return massTypeMapping[massType] || null;
}

async function main() {
    try {
        const outputPath = path.join(__dirname, '..', 'output', 'lectionary.json');
        
        // Initialize the output structure according to the schema
        const output = {
            lectionaryTitle: "USCCB Lectionary (based on 1998)",
            schemaVersion: "1.3", // Updated to match new schema version
            cycles: {
                sundays: { A: [], B: [], C: [] },
                weekdays: { I: [], II: [] }
            },
            properOfSaints: [],
            commons: [],
            ritualMasses: [],
            votiveMasses: [],
            massesForTheDead: []
        };

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
        console.log('Retrieved definitions for', Object.keys(definitions).length, 'liturgical days');
        
        // Generate calendar for current year to access computed properties
        const currentYear = new Date().getFullYear();
        const calendar = await romcal.generateCalendar(currentYear);
        
        // Create a mapping of definition IDs to instances with computed properties
        const computedPropertiesMap = new Map();
        
        // Extract instances with computed properties from the calendar
        for (const [date, days] of Object.entries(calendar)) {
            if (Array.isArray(days) && days.length > 0) {
                for (const day of days) {
                    if (day.id) {
                        // Create an object with computed properties
                        const computedProps = {
                            date: date,
                            id: day.id,
                        };
                        
                        // Extract all relevant computed properties
                        for (const prop of COMPUTED_PROPERTIES) {
                            if (prop in day) {
                                computedProps[prop] = day[prop];
                            }
                        }
                        
                        // Store by ID for later lookup
                        computedPropertiesMap.set(day.id, computedProps);
                    }
                }
            }
        }
        
        // Look for Holy Family feast and other important feasts
        listRomcalFeasts(definitions, 'holy family', computedPropertiesMap);
        listRomcalFeasts(definitions, 'christmas', computedPropertiesMap);
        listRomcalFeasts(definitions, 'epiphany', computedPropertiesMap);
        listRomcalFeasts(definitions, 'baptism', computedPropertiesMap);
        
        // Process CSV files with readings
        const inputDir = path.join(__dirname, '..', 'input');
        console.log('Looking for CSV files in:', inputDir);
        const csvFiles = fs.readdirSync(inputDir)
            .filter(file => file.endsWith('.csv'));
        console.log('Found CSV files:', csvFiles);
        
        if (csvFiles.length === 0) {
            console.error('No CSV files found in input directory');
            return;
        }

        // Store all readings by cycle
        const allReadings = { A: [], B: [], C: [], I: [], II: [] };
        
        for (const file of csvFiles) {
            console.log(`Processing readings from ${file}...`);
            const csvContent = fs.readFileSync(path.join(inputDir, file), 'utf-8');
            const readings = extractReadingsFromCSV(csvContent);
            
            // Merge readings by cycle
            for (const [cycle, cycleReadings] of Object.entries(readings)) {
                if (cycleReadings && cycleReadings.length > 0) {
                    allReadings[cycle].push(...cycleReadings);
                }
            }
        }

        console.log('Total readings collected:', {
            A: allReadings.A.length,
            B: allReadings.B.length,
            C: allReadings.C.length,
            I: allReadings.I.length,
            II: allReadings.II.length
        });

        // Process Sunday and Feast readings
        for (const cycle of ['A', 'B', 'C']) {
            console.log(`Processing ${allReadings[cycle].length} Sunday readings for cycle ${cycle}`);
            for (const reading of allReadings[cycle]) {
                if (reading.isFeast) {
                    // Handle feast days
                    const feastDefinition = findFeastDefinition(definitions, reading.feastIdentifier, computedPropertiesMap);
                    
                    // Generate identifier for the feast
                    const identifier = reading.feastIdentifier + '_' + cycle.toLowerCase();
                    
                    // Special case for Christmas masses
                    let massType = null;
                    if (reading.feastIdentifier && reading.feastIdentifier.includes('christmas_')) {
                        if (reading.feastIdentifier.includes('_vigil_')) {
                            massType = 'Vigil Mass';
                        } else if (reading.feastIdentifier.includes('_night')) {
                            massType = 'Mass during the Night';
                        } else if (reading.feastIdentifier.includes('_dawn')) {
                            massType = 'Mass at Dawn';
                        } else if (reading.feastIdentifier.includes('_day')) {
                            massType = 'Mass during the Day';
                        }
                    }
                    
                    const liturgicalDay = {
                        identifier: identifier,
                        name: feastDefinition ? feastDefinition.name : reading.feastName,
                        romcalKey: feastDefinition ? feastDefinition.id : null,
                        season: feastDefinition?.seasonNames?.[0] || determineSeason(feastDefinition?.id, reading.feastName) || reading.season,
                        week: null, // Feasts don't have week numbers
                        dayOfWeek: "Sunday", // Most feasts are on Sunday
                        date: null, // Most of these feasts are movable
                        rank: normalizeRank(feastDefinition?.rankName || feastDefinition?.rank?.name || "Feast"),
                        massType: normalizeMassType(massType),
                        readings: reading.readings
                    };
                    
                    // Add fixed dates for certain feasts
                    if (reading.feastIdentifier === 'mary_mother_of_god') {
                        liturgicalDay.date = '01-01'; // January 1
                    }
                    
                    output.cycles.sundays[cycle].push(liturgicalDay);
                } else {
                    // Handle regular Sundays
                    const definition = findMatchingDefinition(
                        definitions,
                        reading.season,
                        reading.weekNumber, 
                        computedPropertiesMap
                    );
                    
                    if (definition) {
                        // Generate a unique identifier
                        const identifier = `${reading.season.toLowerCase()}_${reading.weekNumber}_sunday_${cycle.toLowerCase()}`;
                        
                        const computedProps = computedPropertiesMap.get(definition.id) || {};
                        
                        const liturgicalDay = {
                            identifier: identifier,
                            name: computedProps.name || definition.name,
                            romcalKey: definition.id,
                            season: computedProps.seasonNames?.[0] || definition.season || reading.season,
                            week: reading.weekNumber,
                            dayOfWeek: "Sunday",
                            date: null, // No fixed date for movable feasts
                            rank: normalizeRank(computedProps.rankName || definition.rank?.name || "Sunday"),
                            massType: null, // Standard Sunday mass
                            readings: reading.readings
                        };
                        output.cycles.sundays[cycle].push(liturgicalDay);
                    } else {
                        console.warn(`Could not find matching definition for:`, {
                            sourceName: reading.sourceName,
                            season: reading.season,
                            week: reading.weekNumber,
                            cycle: cycle
                        });
                    }
                }
            }
        }
        
        // Process Weekday readings
        for (const cycle of ['I', 'II']) {
            console.log(`Processing ${allReadings[cycle].length} weekday readings for cycle ${cycle}`);
            for (const reading of allReadings[cycle]) {
                // Check if it's an octave day or other special feast
                if (reading.isFeast) {
                    const feastDefinition = findFeastDefinition(definitions, reading.feastIdentifier, computedPropertiesMap);
                    
                    // Generate identifier for the feast
                    const identifier = reading.feastIdentifier + '_' + cycle.toLowerCase();
                    
                    const liturgicalDay = {
                        identifier: identifier,
                        name: feastDefinition ? feastDefinition.name : reading.feastName,
                        romcalKey: feastDefinition ? feastDefinition.id : null,
                        season: feastDefinition?.seasonNames?.[0] || determineSeason(feastDefinition?.id, reading.feastName) || reading.season,
                        week: reading.weekNumber,
                        dayOfWeek: reading.dayOfWeek,
                        date: null, // These are movable feasts
                        rank: normalizeRank(feastDefinition?.rankName || feastDefinition?.rank?.name || "Feast"),
                        massType: null,
                        readings: reading.readings
                    };
                    
                    output.cycles.weekdays[cycle].push(liturgicalDay);
                } else {
                    // Regular weekday
                    // Try to find a romcal definition for this day
                    const romcalPattern = `easter_time_${reading.weekNumber}_${reading.dayOfWeek.toLowerCase()}`;
                    
                    // Find the definition for this weekday
                    const matchingDefinitions = Object.values(definitions).filter(def => {
                        return def.id && def.id.toLowerCase().includes(romcalPattern);
                    });
                    
                    let romcalDef = null;
                    if (matchingDefinitions.length > 0) {
                        romcalDef = matchingDefinitions[0];
                        const computedProps = computedPropertiesMap.get(romcalDef.id) || {};
                        
                        console.log(`Found weekday definition:`, {
                            id: romcalDef.id,
                            name: computedProps.name || romcalDef.name,
                            seasonNames: computedProps.seasonNames,
                            colorNames: computedProps.colorNames
                        });
                        
                        // Enhance the definition with computed properties
                        romcalDef = {
                            ...romcalDef,
                            name: computedProps.name || romcalDef.name,
                            seasonNames: computedProps.seasonNames || [],
                            colorNames: computedProps.colorNames || [],
                            rankName: computedProps.rankName
                        };
                    }
                    
                    // Generate a unique identifier
                    const identifier = `${reading.season.toLowerCase()}_${reading.weekNumber}_${reading.dayOfWeek.toLowerCase()}_${cycle.toLowerCase()}`;
                    
                    const liturgicalDay = {
                        identifier: identifier,
                        name: romcalDef ? romcalDef.name : reading.feastName,
                        romcalKey: romcalDef ? romcalDef.id : null,
                        season: romcalDef?.seasonNames?.[0] || determineSeason(romcalDef?.id, romcalDef?.name) || reading.season,
                        week: reading.weekNumber,
                        dayOfWeek: reading.dayOfWeek,
                        date: null,
                        rank: normalizeRank(romcalDef?.rankName || romcalDef?.rank?.name || "Weekday"),
                        massType: null,
                        readings: reading.readings
                    };
                    
                    output.cycles.weekdays[cycle].push(liturgicalDay);
                }
            }
        }
        
        // Sort arrays by date (when available) and then by week number and day of week
        function sortLiturgicalDays(a, b) {
            // Put fixed dates first
            if (a.date && !b.date) return -1;
            if (!a.date && b.date) return 1;
            
            // Sort by date if both have dates
            if (a.date && b.date) {
                return a.date.localeCompare(b.date);
            }
            
            // Sort by season (Christmas before Ordinary)
            const seasonOrder = { 'CHRISTMAS': 1, 'ORDINARY': 2, 'LENT': 3, 'EASTER': 4, 'ADVENT': 5 };
            if (a.season !== b.season) {
                return (seasonOrder[a.season] || 99) - (seasonOrder[b.season] || 99);
            }
            
            // Sort by week number
            if (a.week !== b.week) {
                return (a.week || 0) - (b.week || 0);
            }
            
            // Sort by day of week using numeric ordering (Sunday=0, Monday=1, etc.)
            const dayOrder = {
                'Sunday': 0, 
                'Monday': 1, 
                'Tuesday': 2, 
                'Wednesday': 3, 
                'Thursday': 4, 
                'Friday': 5, 
                'Saturday': 6
            };
            
            const aDayOrder = dayOrder[a.dayOfWeek] !== undefined ? dayOrder[a.dayOfWeek] : 99;
            const bDayOrder = dayOrder[b.dayOfWeek] !== undefined ? dayOrder[b.dayOfWeek] : 99;
            
            return aDayOrder - bDayOrder;
        }

        // Sort all arrays
        Object.values(output.cycles.sundays).forEach(arr => arr.sort(sortLiturgicalDays));
        Object.values(output.cycles.weekdays).forEach(arr => arr.sort(sortLiturgicalDays));
        
        // Double check the sorting on weekdays specifically to ensure they're in proper order
        for (const cycle of ['I', 'II']) {
            // First sort by week
            output.cycles.weekdays[cycle].sort((a, b) => {
                // Sort octave days (week 1) first
                if (a.identifier?.includes('octave') && !b.identifier?.includes('octave')) return -1;
                if (!a.identifier?.includes('octave') && b.identifier?.includes('octave')) return 1;
                
                // Then sort by week number
                return (a.week || 0) - (b.week || 0);
            });
            
            // Then sort days within each week by their day of week order
            const groupedByWeek = {};
            output.cycles.weekdays[cycle].forEach(day => {
                const weekNum = day.week || 0;
                if (!groupedByWeek[weekNum]) groupedByWeek[weekNum] = [];
                groupedByWeek[weekNum].push(day);
            });
            
            // Sort each week's days by day of week
            Object.values(groupedByWeek).forEach(weekDays => {
                weekDays.sort((a, b) => {
                    const dayOrder = {
                        'Sunday': 0, 
                        'Monday': 1, 
                        'Tuesday': 2, 
                        'Wednesday': 3, 
                        'Thursday': 4, 
                        'Friday': 5, 
                        'Saturday': 6
                    };
                    
                    return (dayOrder[a.dayOfWeek] || 99) - (dayOrder[b.dayOfWeek] || 99);
                });
            });
            
            // Reassemble the sorted array
            output.cycles.weekdays[cycle] = [];
            for (const weekNum of Object.keys(groupedByWeek).sort((a, b) => parseInt(a) - parseInt(b))) {
                output.cycles.weekdays[cycle].push(...groupedByWeek[weekNum]);
            }
        }

        // Save the calendar data
        fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
        console.log(`Created/Updated ${outputPath}`);
    } catch (error) {
        console.error('Error:', error);
    }
}

main();