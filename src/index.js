import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync'; // Replace cheerio with csv-parse
import { bcv_parser } from "bible-passage-reference-parser/esm/bcv_parser.js";
import * as lang from "bible-passage-reference-parser/esm/lang/full.js";
import { Romcal } from 'romcal';
import { UnitedStates_En } from '@romcal/calendar.united-states';

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
    
    const readings = { A: [], B: [], C: [] }; // Initialize structure for Sunday cycles
    
    for (const record of records) {
        // Handle different CSV column names
        const columnNames = Object.keys(record);
        const sundayDescColumn = columnNames.find(name => name.includes('Sunday') || name.includes('Feast')) || 'Sunday';
        const firstReadingRef = record['First Reading'];
        const psalmRef = record['Responsorial Psalm'];
        const secondReadingRef = record['Second Reading'];
        
        // Check for different variations of the Gospel Acclamation column
        const alleluiaRef = record[columnNames.find(name => 
            name.includes('Alleluia') || 
            name.includes('Verse before') ||
            name.includes('Gospel Acclamation')
        )] || record['Verse before the Gospel'] || record['Alleluia'] || record['Alleluia Verse'];
        
        const gospelRef = record['Gospel'];
        
        const sundayDescription = record[sundayDescColumn];
        if (!sundayDescription) continue; // Skip rows without a Sunday/Feast description
        
        // Check if this is Palm Sunday (special case)
        const isPalmSunday = /palm\s+sunday/i.test(sundayDescription);
        
        // Determine if this is a special feast or a regular Sunday
        const isRegularSunday = /(\d+)(?:st|nd|rd|th)\s+Sunday\s+of\s+(\w+)\s+[–-]\s+([ABC])/i.test(sundayDescription);
        
        if (isRegularSunday || isPalmSunday) {
            // Handle regular Sundays and Palm Sunday
            const descMatch = sundayDescription.match(/(?:(\d+)(?:st|nd|rd|th)\s+Sunday\s+of\s+(\w+)|(.+?))\s+[–-]\s+([ABC])/i);
            if (!descMatch) {
                console.warn(`Could not parse Sunday description: ${sundayDescription}`);
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
                console.warn(`Invalid or missing cycle in: ${sundayDescription}`);
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
                sourceName: sundayDescription, // Keep original name for matching/debugging
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
            const feastMatch = sundayDescription.match(/([^-]+)\s*-\s*([ABC]+)/i);
            if (!feastMatch) {
                console.warn(`Could not parse feast description: ${sundayDescription}`);
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
                    sourceName: sundayDescription,
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
function findMatchingDefinition(definitions, season, weekNumber) {
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
        console.log(`Found matching definition:`, {
            id: match.id,
            name: match.name
        });
        return match;
    }
    
    console.log('No matching definition found');
    return null;
}

// Function to list romcal definitions matching a pattern with more detailed information
function listRomcalFeasts(definitions, pattern) {
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
            console.log(`- ID: ${match.id}`);
            console.log(`  Name: ${match.name}`);
            console.log(`  Season: ${match.season || 'undefined'}`);
            console.log(`  Rank: ${match.rank?.name || 'undefined'}`);
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

// Helper function to find matching feast from partial name or keywords
function findFeastByKeywords(definitions, keywords) {
    console.log(`Searching for feast with keywords: ${keywords.join(', ')}`);
    
    // Convert keywords to lowercase for case-insensitive matching
    const lowerKeywords = keywords.map(k => k.toLowerCase());
    
    // Score-based matching to find the best match
    const matches = Object.values(definitions)
        .filter(def => def.id && def.name) // Must have both ID and name
        .map(def => {
            // Count how many keywords match in the ID and name
            const idMatches = lowerKeywords.filter(k => 
                def.id.toLowerCase().includes(k)).length;
                
            const nameMatches = lowerKeywords.filter(k => 
                def.name.toLowerCase().includes(k)).length;
                
            // Calculate a score based on matches (name matches weighted higher)
            const score = idMatches + (nameMatches * 2);
            
            return { definition: def, score };
        })
        .filter(item => item.score > 0) // Must match at least one keyword
        .sort((a, b) => b.score - a.score); // Sort by score descending
    
    if (matches.length > 0) {
        console.log(`Found ${matches.length} potential matches:`);
        matches.slice(0, 3).forEach((match, idx) => {
            console.log(`[${idx + 1}] Score: ${match.score}`);
            console.log(`    ID: ${match.definition.id}`);
            console.log(`    Name: ${match.definition.name}`);
        });
        
        // Return the best match
        return matches[0].definition;
    }
    
    console.log('No matching feasts found');
    return null;
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
        
        // Get all liturgical day definitions (instead of generating a specific year's calendar)
        console.log('Getting liturgical day definitions...');
        const definitions = await romcal.getAllDefinitions();
        console.log('Retrieved definitions for', Object.keys(definitions).length, 'liturgical days');
        
        // Look for Holy Family feast and other important feasts
        listRomcalFeasts(definitions, 'holy family');
        listRomcalFeasts(definitions, 'christmas');
        listRomcalFeasts(definitions, 'epiphany');
        listRomcalFeasts(definitions, 'baptism');
        
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
        const allReadings = { A: [], B: [], C: [] };
        
        for (const file of csvFiles) {
            console.log(`Processing readings from ${file}...`);
            const csvContent = fs.readFileSync(path.join(inputDir, file), 'utf-8');
            const readings = extractReadingsFromCSV(csvContent);
            
            // Merge readings by cycle
            for (const [cycle, cycleReadings] of Object.entries(readings)) {
                allReadings[cycle].push(...cycleReadings);
            }
        }

        console.log('Total readings collected:', {
            A: allReadings.A.length,
            B: allReadings.B.length,
            C: allReadings.C.length
        });

        // Helper function to find feast definition from romcal
        function findFeastDefinition(definitions, feastIdentifier) {
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
                'palm_sunday': 'palm_sunday_of_the_passion_of_the_lord'
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
                console.log(`Found feast definition:`, {
                    id: match.id,
                    name: match.name
                });
                return match;
            }
            
            console.log('No feast definition found');
            return null;
        }
        
        // Add the readings to the output structure
        for (const [cycle, readings] of Object.entries(allReadings)) {
            console.log(`Processing ${readings.length} readings for cycle ${cycle}`);
            for (const reading of readings) {
                if (reading.isFeast) {
                    // Handle feast days
                    const feastDefinition = findFeastDefinition(definitions, reading.feastIdentifier);
                    
                    // Generate identifier for the feast
                    const identifier = reading.feastIdentifier + '_' + cycle.toLowerCase();
                    
                    // Special case for Christmas masses
                    let massType = null;
                    if (reading.feastIdentifier.includes('christmas_')) {
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
                        name: reading.feastName,
                        romcalKey: feastDefinition ? feastDefinition.id : null,
                        season: reading.season,
                        week: null, // Feasts don't have week numbers
                        dayOfWeek: "Sunday", // Most feasts are on Sunday
                        date: null, // Most of these feasts are movable
                        rank: feastDefinition ? feastDefinition.rank?.name || "Feast" : "Feast",
                        massType: massType,
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
                        reading.weekNumber
                    );
                    
                    if (definition) {
                        // Generate a unique identifier
                        const identifier = `${reading.season.toLowerCase()}_${reading.weekNumber}_sunday_${cycle.toLowerCase()}`;
                        
                        const liturgicalDay = {
                            identifier: identifier,
                            name: definition.name, // Use the name from romcal definition instead of our generated name
                            romcalKey: definition.id,
                            season: definition.season || reading.season,
                            week: reading.weekNumber,
                            dayOfWeek: "Sunday",
                            date: null, // No fixed date for movable feasts
                            rank: definition.rank?.name || "Sunday",
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
        
        // Sort arrays by date (when available) and then by week number
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
            
            // Finally sort by week number
            return (a.week || 0) - (b.week || 0);
        }

        // Sort all arrays
        Object.values(output.cycles.sundays).forEach(arr => arr.sort(sortLiturgicalDays));

        // Save the calendar data
        fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
        console.log(`Created/Updated ${outputPath}`);
    } catch (error) {
        console.error('Error:', error);
    }
}

main();