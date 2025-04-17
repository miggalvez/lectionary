import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync'; // Replace cheerio with csv-parse
import { bcv_parser } from "bible-passage-reference-parser/esm/bcv_parser.js";
import * as lang from "bible-passage-reference-parser/esm/lang/full.js";
import { Romcal } from 'romcal';
import { GeneralRoman_En } from '@romcal/calendar.general-roman';

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

function processReference(reference) {
    if (!reference || reference.toLowerCase() === '(no bibl. ref.)') return [];
    
    const readingOptions = [];
    // Split by "or" first to handle alternative readings
    const options = reference.split(/\s+or\s+/i);
    
    for (const option of options) {
        const cleanReference = option
            .replace(/[‒–—―]/g, '-') // Replace any kind of dash with regular hyphen
            .replace(/\s*-\s*Vg.*|\(.*?\)/g, '') // Strip annotations like "- Vg (diff)" or "(new)"
            .replace(/\s*,\s*/g, ', ') // Normalize spaces around commas
            .replace(/(\d+)\s*:\s*(\d+)/g, '$1:$2') // Clean up spaces around colons
            .replace(/\s+/g, ' ') // Normalize multiple spaces
            .replace(/\+/g, '+') // Keep + for verse sequences
            .replace(/[^\x00-\x7F]/g, '-') // Replace any non-ASCII char with regular hyphen
            .trim();
            
        if (!cleanReference) continue;
        
        try {
            const parsingResult = bcv.parse(cleanReference);
            const osis = parsingResult.osis();
            
            if (osis) {
                // Store the original cleaned reference as the standard format
                const standardReference = cleanReference;
                
                // Determine if it's a short form based on original text
                let note = null;
                if (/\(short form\)/i.test(option)) {
                    note = 'short form';
                } else if (options.length > 1) {
                    note = 'alternative/option';
                }
                
                readingOptions.push({
                    referenceOsis: osis, // OSIS format as required by schema
                    referenceStandard: standardReference, // Original cleaned reference
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
        const sundayDescription = record['Sunday']; // Column name from CSV
        const firstReadingRef = record['First Reading'];
        const psalmRef = record['Responsorial Psalm'];
        const secondReadingRef = record['Second Reading'];
        const alleluiaRef = record['Alleluia Verse'];
        const gospelRef = record['Gospel'];
        
        if (!sundayDescription) continue; // Skip rows without a Sunday description
        
        // Parse Sunday description (e.g., "1st Sunday of Advent - A")
        const descMatch = sundayDescription.match(/(\d+)(?:st|nd|rd|th)\s+Sunday\s+of\s+(\w+)\s+-\s+([ABC])/i);
        if (!descMatch) {
            console.warn(`Could not parse Sunday description: ${sundayDescription}`);
            continue;
        }
        
        const [, weekNumberStr, seasonName, cycle] = descMatch;
        const weekNumber = parseInt(weekNumberStr);
        const season = seasonName.toUpperCase(); // e.g., ADVENT
        
        // Basic validation
        if (!cycle || !['A', 'B', 'C'].includes(cycle)) {
            console.warn(`Invalid or missing cycle in: ${sundayDescription}`);
            continue;
        }
        
        // Create object to store information about this reading
        let readingInfo = {
            sourceName: sundayDescription, // Keep original name for matching/debugging
            feastName: `${weekNumberStr} Sunday of ${seasonName}`,
            cycle: cycle,
            weekNumber: weekNumber,
            season: season,
            dayOfWeek: 'Sunday', // Assuming all entries in this file are Sundays
            readings: {
                first_reading: processReference(firstReadingRef),
                responsorial_psalm: processReference(psalmRef),
                second_reading: processReference(secondReadingRef),
                gospel_acclamation: processReference(alleluiaRef),
                gospel: processReference(gospelRef)
            }
        };
        
        // Add the reading data to the appropriate cycle
        readings[cycle].push(readingInfo);
    }
    
    return readings;
}

// Helper function to find matching romcal day
function findMatchingRomcalDay(romcalCalendar, season, weekNumber, cycle) {
    console.log(`Looking for romcal match:`, { season, weekNumber, cycle });
    
    // Debug: Print a few romcal days to see their structure
    const sampleDays = Object.entries(romcalCalendar).slice(0, 5);
    for (const [date, days] of sampleDays) {
        const day = days[0];
        console.log(`Sample romcal day:`, {
            date,
            id: day.id,
            name: day.name,
            season: day.seasons?.[0],
            week: day.calendar?.weekOfSeason,
            dayOfWeek: day.calendar?.dayOfWeek,
            cycle: day.cycles?.sundayCycle
        });
    }
    
    for (const [romcalDate, days] of Object.entries(romcalCalendar)) {
        const day = days[0]; // Get the primary liturgical day
        
        if (!day.calendar || !day.seasons || !day.cycles) {
            continue;
        }
        
        // Check if this is a Sunday (romcal uses 0 for Sunday)
        if (day.calendar.dayOfWeek === 0) {
            // Check if the season and week match
            const romcalSeason = day.seasons[0];
            const romcalWeek = day.calendar.weekOfSeason;
            const romcalCycle = day.cycles.sundayCycle;
            
            // Debug specific case
            if (romcalSeason && romcalSeason.includes("ADVENT")) {
                console.log(`Found Advent day:`, {
                    date: romcalDate,
                    id: day.id,
                    season: romcalSeason,
                    week: romcalWeek,
                    cycle: romcalCycle
                });
            }
            
            // More flexible matching - case insensitive season comparison
            if (romcalSeason && season && 
                romcalSeason.toUpperCase().includes(season.toUpperCase()) &&
                romcalWeek === weekNumber &&
                romcalCycle === cycle) {
                console.log(`Found match! ID: ${day.id}`);
                return day;
            }
        }
    }
    
    // If no exact match, try with just the season and week
    for (const [romcalDate, days] of Object.entries(romcalCalendar)) {
        const day = days[0];
        
        if (!day.calendar || !day.seasons) {
            continue;
        }
        
        if (day.calendar.dayOfWeek === 0) { // Sunday
            const romcalSeason = day.seasons[0];
            const romcalWeek = day.calendar.weekOfSeason;
            
            if (romcalSeason && season &&
                romcalSeason.toUpperCase().includes(season.toUpperCase()) &&
                romcalWeek === weekNumber) {
                console.log(`Found partial match by season and week! ID: ${day.id}`);
                return day;
            }
        }
    }
    
    console.log('No match found');
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
        
        // Initialize romcal first
        const romcal = new Romcal({
            scope: 'liturgical',
            locale: 'en',
            localizedCalendar: GeneralRoman_En,
            epiphanyOnSunday: true,
            corpusChristiOnSunday: true,
            ascensionOnSunday: false,
        });
        
        // Generate calendar for a fixed year (2025)
        console.log('Generating liturgical calendar...');
        const calendar = await romcal.generateCalendar(2025);
        console.log('Romcal calendar generated with', Object.keys(calendar).length, 'days');
        
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
        
        // Add the readings to the output structure
        for (const [cycle, readings] of Object.entries(allReadings)) {
            console.log(`Processing ${readings.length} readings for cycle ${cycle}`);
            for (const reading of readings) {
                // Find matching romcal day
                const romcalDay = findMatchingRomcalDay(
                    calendar,
                    reading.season,
                    reading.weekNumber,
                    cycle
                );
                
                if (romcalDay) {
                    // Generate a unique identifier
                    const identifier = `${reading.season.toLowerCase()}_${reading.weekNumber}_sunday_${cycle.toLowerCase()}`;
                    
                    const liturgicalDay = {
                        identifier: identifier,
                        name: reading.feastName,
                        romcalKey: romcalDay.id,
                        season: romcalDay.seasons?.[0] || reading.season,
                        week: romcalDay.calendar?.weekOfSeason || reading.weekNumber,
                        dayOfWeek: "Sunday",
                        date: romcalDay.date ? normalizeDate(romcalDay.date) : null,
                        rank: "Sunday",
                        massType: null, // Standard Sunday mass
                        readings: reading.readings
                    };
                    output.cycles.sundays[cycle].push(liturgicalDay);
                } else {
                    console.warn(`Could not find matching romcal day for:`, {
                        sourceName: reading.sourceName,
                        season: reading.season,
                        week: reading.weekNumber,
                        cycle: cycle
                    });
                }
            }
        }
        
        // Sort arrays by week number
        function sortByWeek(a, b) {
            return (a.week || 0) - (b.week || 0);
        }
        
        // Sort all arrays
        Object.values(output.cycles.sundays).forEach(arr => arr.sort(sortByWeek));
        
        // Save the calendar data
        fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
        console.log(`Created/Updated ${outputPath}`);
    } catch (error) {
        console.error('Error:', error);
    }
}

main();