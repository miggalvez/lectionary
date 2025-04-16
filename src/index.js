import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
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
    "versification_system": "nab"
});

// Define computed fields that need to be accessed as properties
const COMPUTED_FIELDS = ['name', 'colorNames', 'seasonNames', 'rankName', 'definition', 'config'];

function processReference(reference) {
    if (!reference) return null;
    
    try {
        const parsingResult = bcv.parse(reference);
        const verses = new Set(); // Use Set to avoid duplicates
        
        // Get all sequences and ranges from the parsing result
        const entities = parsingResult.parsed_entities();
        for (const entity of entities) {
            processEntity(entity, verses);
        }

        // Get the OSIS reference
        const osis = parsingResult.osis();
        
        // Clean up the formatted text
        const formattedText = reference
            .replace(/[‒–—―]/g, '-') // Replace any kind of dash with regular hyphen
            .replace(/\s*,\s*/g, ', ') // Normalize spaces around commas
            .replace(/(\d+)\s*:\s*(\d+)/g, '$1:$2') // Clean up spaces around colons
            .replace(/\s+/g, ' ') // Normalize multiple spaces
            .replace(/\+/g, ',') // Replace + with comma in references
            .replace(/[^\x00-\x7F]/g, '-') // Replace any non-ASCII char with regular hyphen
            .trim();

        return {
            range: Array.from(verses).sort(compareVerses),
            osis: osis,
            formatted: formattedText
        };
    } catch (error) {
        console.error(`Error processing reference: ${reference}`, error);
        return null;
    }
}

function processEntity(entity, verses) {
    if (!entity) return;
    
    if (entity.type === "sequence") {
        // Handle comma-separated references
        for (const item of entity.entities) {
            processEntity(item, verses);
        }
    } else if (entity.type === "range") {
        // Handle ranges like "1-5" or "1:1-2:5"
        const startBook = entity.start.b;
        const startChapter = entity.start.c;
        const startVerse = entity.start.v;
        const endBook = entity.end.b;
        const endChapter = entity.end.c;
        const endVerse = entity.end.v;
        
        let currentBook = startBook;
        let currentChapter = startChapter;
        let currentVerse = startVerse;
        
        while (true) {
            // Check for verse parts (a, b, c, etc.)
            const versePart = entity.start.partial_verse || '';
            verses.add(`${currentBook}.${currentChapter}.${currentVerse}${versePart}`);
            
            if (currentBook === endBook && currentChapter === endChapter && currentVerse === endVerse) {
                break;
            }
            
            currentVerse++;
            const maxVerse = bcv.translation_info(translation).chapters[currentBook][currentChapter - 1];
            if (currentVerse > maxVerse) {
                currentVerse = 1;
                currentChapter++;
                const maxChapter = bcv.translation_info(translation).chapters[currentBook].length;
                if (currentChapter > maxChapter) {
                    currentChapter = 1;
                    const bookIndex = bcv.translation_info(translation).books.indexOf(currentBook);
                    if (bookIndex < 0 || bookIndex >= bcv.translation_info(translation).books.length - 1) break;
                    currentBook = bcv.translation_info(translation).books[bookIndex + 1];
                }
            }
        }
    } else if (entity.type === "bcv") {
        // Handle single verse references
        const versePart = entity.start.partial_verse || '';
        verses.add(`${entity.start.b}.${entity.start.c}.${entity.start.v}${versePart}`);
    } else if (entity.type === "bc") {
        // Handle full chapter references
        const book = entity.start.b;
        const chapter = entity.start.c;
        const numVerses = bcv.translation_info(translation).chapters[book][chapter - 1];
        for (let verse = 1; verse <= numVerses; verse++) {
            verses.add(`${book}.${chapter}.${verse}`);
        }
    } else if (entity.type === "b") {
        // Handle full book references
        const book = entity.start.b;
        const numChapters = bcv.translation_info(translation).chapters[book].length;
        for (let chapter = 1; chapter <= numChapters; chapter++) {
            const numVerses = bcv.translation_info(translation).chapters[book][chapter - 1];
            for (let verse = 1; verse <= numVerses; verse++) {
                verses.add(`${book}.${chapter}.${verse}`);
            }
        }
    } else if (entity.type === "integer" || entity.type === "v") {
        // Handle single verse numbers in a sequence
        const context = entity.context || (entity.start && { b: entity.start.b, c: entity.start.c });
        if (context && context.b && context.c) {
            const verse = entity.type === "integer" ? parseInt(entity.value || entity.start.v) : parseInt(entity.start.v);
            if (!isNaN(verse)) {
                const versePart = entity.start.partial_verse || '';
                verses.add(`${context.b}.${context.c}.${verse}${versePart}`);
            }
        }
    } else if (entity.entities && entity.entities.length > 0) {
        // Handle nested entities
        for (const item of entity.entities) {
            processEntity(item, verses);
        }
    }
}

function compareVerses(a, b) {
    const [aBook, aChapter, aVerse] = a.split('.');
    const [bBook, bChapter, bVerse] = b.split('.');
    
    // Compare book names using the bible-passage-reference-parser's book order
    const aBookIndex = bcv.translation_info(translation).books.indexOf(aBook);
    const bBookIndex = bcv.translation_info(translation).books.indexOf(bBook);
    
    if (aBookIndex !== bBookIndex) return aBookIndex - bBookIndex;
    if (parseInt(aChapter) !== parseInt(bChapter)) return parseInt(aChapter) - parseInt(bChapter);
    return parseInt(aVerse) - parseInt(bVerse);
}

function extractReadingsFromHTML(htmlContent) {
    const $ = cheerio.load(htmlContent);
    const readings = {};
    
    // Find all tables in the document
    $('table').each((tableIndex, table) => {
        console.log(`Processing table ${tableIndex + 1}`);
        
        // Find all rows in the table
        $(table).find('tr').each((rowIndex, row) => {
            const cells = $(row).find('td');
            if (cells.length >= 7) { // Weekday readings have 7 columns
                const date = $(cells[0]).text().trim();
                const number = $(cells[1]).text().trim();
                const dayText = $(cells[2]).text().trim();
                const firstReading = $(cells[3]).text().trim();
                const psalm = $(cells[4]).text().trim();
                const secondReading = $(cells[5]).text().trim();
                const gospel = $(cells[7]).text().trim() || $(cells[6]).text().trim(); // Try column 7 first, then 6
                const alleluia = $(cells[6]).text().trim(); // Column 6 is alleluia verse

                console.log('Processing row:', { date, dayText, firstReading, psalm, secondReading, alleluia, gospel });

                // Extract cycle from dayText (e.g., "1st Sunday of Advent - A")
                const cycleMatch = dayText.match(/- ([ABC])$/i);
                const cycle = cycleMatch ? cycleMatch[1].toUpperCase() : null;

                // Extract the day name and week (e.g., "1st Sunday of Advent")
                const match = dayText.match(/(\d+)(?:st|nd|rd|th)\s+(?:Week\s+of\s+)?(\w+)\s+of\s+(\w+)/i);
                if (match) {
                    const [_, weekNumber, dayType, season] = match;
                    console.log('Matched:', { weekNumber, dayType, season, cycle });
                    
                    // Create a unique identifier for this day
                    const identifier = `${season.toLowerCase()}_${weekNumber}_${dayType.toLowerCase()}`;
                    
                    // Format the date to MM-DD
                    const [month, day] = date.split('/');
                    const formattedDate = `${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
                    
                    // Create the reading set
                    const readingSet = {
                        date: formattedDate,
                        cycle: cycle || 'A', // Default to Year A if no cycle specified
                        weekNumber: parseInt(weekNumber),
                        season: season,
                        dayOfWeek: dayType,
                        readings: {
                            first_reading: firstReading ? [{ 
                                osis: processReference(firstReading).osis,
                                reference: firstReading 
                            }] : [],
                            responsorial_psalm: psalm ? [{ 
                                osis: processReference(psalm).osis,
                                reference: psalm 
                            }] : [],
                            second_reading: secondReading ? [{ 
                                osis: processReference(secondReading).osis,
                                reference: secondReading 
                            }] : [],
                            gospel_acclamation: alleluia ? [{ 
                                osis: processReference(alleluia).osis,
                                reference: alleluia 
                            }] : [],
                            gospel: gospel ? [{ 
                                osis: processReference(gospel).osis,
                                reference: gospel 
                            }] : []
                        }
                    };

                    if (!readings[cycle || 'A']) {
                        readings[cycle || 'A'] = [];
                    }
                    readings[cycle || 'A'].push(readingSet);
                } else {
                    console.log('No match for:', dayText);
                }
            }
        });
    });

    console.log('Extracted readings:', JSON.stringify(readings, null, 2));
    return readings;
}

// Helper function to find matching romcal day
function findMatchingRomcalDay(romcalCalendar, date, season, weekNumber, dayOfWeek, cycle) {
    console.log(`Looking for match:`, { date, season, weekNumber, dayOfWeek, cycle });
    
    // Normalize season name to match romcal format
    const normalizedSeason = season.toUpperCase();
    
    // First try to find an exact match by season, week number, and cycle
    for (const [romcalDate, days] of Object.entries(romcalCalendar)) {
        const day = days[0]; // Get the primary liturgical day
        
        // Check if this is a Sunday (romcal uses 0 for Sunday)
        if (day.calendar?.dayOfWeek === 0) {
            // Check if the season and week match
            const romcalSeason = day.seasons?.[0];
            const romcalWeek = day.calendar?.weekOfSeason;
            const romcalCycle = day.cycles?.sundayCycle;
            
            console.log(`Checking romcal day:`, {
                date: romcalDate,
                season: romcalSeason,
                week: romcalWeek,
                dayOfWeek: day.calendar?.dayOfWeek,
                cycle: romcalCycle
            });
            
            // Match based on season, week number, and cycle
            if (romcalSeason && romcalWeek && 
                romcalSeason === normalizedSeason &&
                romcalWeek === parseInt(weekNumber) &&
                romcalCycle === cycle) {
                console.log(`Found exact match! ID: ${day.id}`);
                return day;
            }
        }
    }
    
    // If no exact match found, try to find the closest match by season and week number
    for (const [romcalDate, days] of Object.entries(romcalCalendar)) {
        const day = days[0];
        if (day.calendar?.dayOfWeek === 0) {
            const romcalSeason = day.seasons?.[0];
            const romcalWeek = day.calendar?.weekOfSeason;
            
            // Match based on season and week number only
            if (romcalSeason && romcalWeek && 
                romcalSeason === normalizedSeason &&
                romcalWeek === parseInt(weekNumber)) {
                console.log(`Found partial match by season and week! ID: ${day.id}`);
                return day;
            }
        }
    }
    
    // If still no match, try to find the closest match by season only
    for (const [romcalDate, days] of Object.entries(romcalCalendar)) {
        const day = days[0];
        if (day.calendar?.dayOfWeek === 0) {
            const romcalSeason = day.seasons?.[0];
            
            // Match based on season only
            if (romcalSeason && romcalSeason === normalizedSeason) {
                console.log(`Found partial match by season! ID: ${day.id}`);
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
            schemaVersion: "1.1",
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

        // Log some sample days from the calendar
        console.log('Sample romcal days:');
        Object.entries(calendar).slice(0, 5).forEach(([date, days]) => {
            const day = days[0];
            console.log({
                date,
                id: day.id,
                name: day.name,
                season: day.seasons?.[0],
                week: day.calendar?.weekOfSeason,
                dayOfWeek: day.calendar?.dayOfWeek
            });
        });

        // Process HTML files with readings
        const inputDir = path.join(__dirname, '..', 'input');
        console.log('Looking for HTML files in:', inputDir);
        const htmlFiles = fs.readdirSync(inputDir)
            .filter(file => file.endsWith('.html'));
        console.log('Found HTML files:', htmlFiles);

        if (htmlFiles.length === 0) {
            console.error('No HTML files found in input directory');
            return;
        }

        // Store all readings by cycle
        const allReadings = { A: [], B: [], C: [] };
        
        for (const file of htmlFiles) {
            console.log(`Processing readings from ${file}...`);
            const htmlContent = fs.readFileSync(path.join(inputDir, file), 'utf-8');
            const readings = extractReadingsFromHTML(htmlContent);
            console.log(`Extracted readings from ${file}:`, readings);
            
            // Merge readings by cycle
            for (const [cycle, cycleReadings] of Object.entries(readings)) {
                console.log(`Adding readings for cycle ${cycle}:`, cycleReadings.length);
                allReadings[cycle].push(...cycleReadings);
            }
        }

        console.log('Total readings collected:', {
            A: allReadings.A.length,
            B: allReadings.B.length,
            C: allReadings.C.length
        });

        // Add the readings to the output structure, using romcal identifiers
        for (const [cycle, readings] of Object.entries(allReadings)) {
            console.log(`Processing ${readings.length} readings for cycle ${cycle}`);
            for (const reading of readings) {
                // Find matching romcal day
                const romcalDay = findMatchingRomcalDay(
                    calendar,
                    reading.date,
                    reading.season,
                    reading.weekNumber,
                    reading.dayOfWeek,
                    cycle
                );

                if (romcalDay) {
                    const liturgicalDay = {
                        identifier: romcalDay.id,
                        name: romcalDay.name,
                        season: romcalDay.seasons?.[0] || null,
                        week: romcalDay.calendar?.weekOfSeason || null,
                        dayOfWeek: romcalDay.calendar?.dayOfWeek || null,
                        date: romcalDay.date ? normalizeDate(romcalDay.date) : null,
                        rank: romcalDay.rankName || null,
                        hasVigil: false,
                        readings: {
                            first_reading: reading.readings.first_reading,
                            responsorial_psalm: reading.readings.responsorial_psalm,
                            second_reading: reading.readings.second_reading,
                            gospel_acclamation: reading.readings.gospel_acclamation,
                            gospel: reading.readings.gospel
                        }
                    };
                    output.cycles.sundays[cycle].push(liturgicalDay);
                    console.log(`Added liturgical day with ID: ${liturgicalDay.identifier}`);
                } else {
                    console.warn(`Could not find matching romcal day for:`, {
                        date: reading.date,
                        season: reading.season,
                        week: reading.weekNumber,
                        dayOfWeek: reading.dayOfWeek
                    });
                }
            }
        }

        // Process each day in the calendar to add non-Sunday celebrations
        console.log('Processing non-Sunday celebrations...');
        for (const [date, days] of Object.entries(calendar)) {
            const day = days[0]; // Get the primary liturgical day
            
            if (day.cycles?.weekdayCycle && ['I', 'II'].includes(day.cycles.weekdayCycle)) {
                // Weekday
                const cycle = day.cycles.weekdayCycle;
                const liturgicalDay = createLiturgicalDay(day);
                output.cycles.weekdays[cycle].push(liturgicalDay);
                console.log(`Added weekday with ID: ${liturgicalDay.identifier}`);
                
            } else if (day.fromCalendarId === 'properOfSaints') {
                const liturgicalDay = createLiturgicalDay(day);
                output.properOfSaints.push(liturgicalDay);
                console.log(`Added proper of saints with ID: ${liturgicalDay.identifier}`);
            } else if (day.fromCalendarId === 'commons') {
                const liturgicalDay = createLiturgicalDay(day);
                output.commons.push(liturgicalDay);
                console.log(`Added common with ID: ${liturgicalDay.identifier}`);
            } else if (day.fromCalendarId === 'ritualMasses') {
                const liturgicalDay = createLiturgicalDay(day);
                output.ritualMasses.push(liturgicalDay);
                console.log(`Added ritual mass with ID: ${liturgicalDay.identifier}`);
            } else if (day.fromCalendarId === 'votiveMasses') {
                const liturgicalDay = createLiturgicalDay(day);
                output.votiveMasses.push(liturgicalDay);
                console.log(`Added votive mass with ID: ${liturgicalDay.identifier}`);
            } else if (day.fromCalendarId === 'massesForTheDead') {
                const liturgicalDay = createLiturgicalDay(day);
                output.massesForTheDead.push(liturgicalDay);
                console.log(`Added mass for the dead with ID: ${liturgicalDay.identifier}`);
            }
        }

        console.log('Final data counts:', {
            'sundays.A': output.cycles.sundays.A.length,
            'sundays.B': output.cycles.sundays.B.length,
            'sundays.C': output.cycles.sundays.C.length,
            'weekdays.I': output.cycles.weekdays.I.length,
            'weekdays.II': output.cycles.weekdays.II.length,
            'properOfSaints': output.properOfSaints.length,
            'commons': output.commons.length,
            'ritualMasses': output.ritualMasses.length,
            'votiveMasses': output.votiveMasses.length,
            'massesForTheDead': output.massesForTheDead.length
        });

        // Sort arrays by date
        function sortByDate(a, b) {
            return a.date?.localeCompare(b.date) || 0;
        }

        // Sort all arrays
        Object.values(output.cycles.sundays).forEach(arr => arr.sort(sortByDate));
        Object.values(output.cycles.weekdays).forEach(arr => arr.sort(sortByDate));
        output.properOfSaints.sort(sortByDate);
        output.commons.sort(sortByDate);
        output.ritualMasses.sort(sortByDate);
        output.votiveMasses.sort(sortByDate);
        output.massesForTheDead.sort(sortByDate);

        // Save the calendar data
        fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
        console.log(`Created/Updated ${outputPath}`);

    } catch (error) {
        console.error('Error:', error);
    }
}

main();