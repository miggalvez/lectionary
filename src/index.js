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
            if (cells.length >= 7) { // Readings tables have at least 7 columns
                const date = $(cells[0]).text().trim();
                const number = $(cells[1]).text().trim();
                const dayText = $(cells[2]).text().trim();
                const firstReading = $(cells[3]).text().trim();
                const psalm = $(cells[4]).text().trim();
                const secondReading = $(cells[5]).text().trim();
                const alleluia = $(cells[6]).text().trim();
                const gospel = cells.length >= 8 ? $(cells[7]).text().trim() : "";

                console.log('Processing row:', { date, number, dayText, firstReading, psalm, secondReading, alleluia, gospel });

                // Skip header rows or empty rows
                if (rowIndex === 0 || !dayText || dayText.includes('Sunday or Feast - Year')) {
                    console.log('Skipping header row');
                    return;
                }

                // Extract cycle from dayText
                let cycle = null;
                
                // First try specific ABC pattern at the end like "- ABC"
                const cycleEndMatch = dayText.match(/- ([ABC]+)$/i);
                if (cycleEndMatch) {
                    cycle = cycleEndMatch[1].toUpperCase();
                } 
                // Then try formats like "ABC" within the text
                else {
                    const cycleWithinMatch = dayText.match(/\b([ABC]+)\b/i);
                    if (cycleWithinMatch) {
                        cycle = cycleWithinMatch[1].toUpperCase();
                    }
                }

                // Handle special cases like "ABC" (applies to all cycles)
                if (cycle === 'ABC') {
                    // Create one entry each for A, B, and C
                    ['A', 'B', 'C'].forEach(singleCycle => {
                        processReadingRow($, cells, date, number, dayText, firstReading, psalm, secondReading, alleluia, gospel, singleCycle, readings);
                    });
                } else {
                    // Process with the detected cycle or null
                    processReadingRow($, cells, date, number, dayText, firstReading, psalm, secondReading, alleluia, gospel, cycle, readings);
                }
            }
        });
    });

    return readings;
}

function processReadingRow($, cells, date, number, dayText, firstReading, psalm, secondReading, alleluia, gospel, cycle, readings) {
    // Default to cycle A if not specified
    cycle = cycle || 'A'; 
    
    // Create object to store information about this reading
    let readingInfo = {
        date: null,
        feastName: null,
        cycle: cycle,
        weekNumber: null,
        season: null,
        dayOfWeek: null,
        rank: null,
        isVigil: false,
        identifier: null,
        readings: {
            first_reading: [],
            responsorial_psalm: [],
            second_reading: [],
            gospel_acclamation: [],
            gospel: []
        }
    };
    
    // Process the date (handle formats like "12/24/24")
    if (date && date !== 'x') {
        const dateMatch = date.match(/(\d+)\/(\d+)\/\d+/);
        if (dateMatch) {
            const month = dateMatch[1].padStart(2, '0');
            const day = dateMatch[2].padStart(2, '0');
            readingInfo.date = `${month}-${day}`;
        }
    }

    // Extract feast information - remove any annotations/notes in brackets
    const cleanDayText = dayText.replace(/\[(.*?)\]/g, '').trim();
    const feastMatch = cleanDayText.match(/([^-:]+?)(?:\s*-\s*[ABC]+|\s*\(|$)/);
    if (feastMatch) {
        readingInfo.feastName = feastMatch[1].trim();
    }
    
    // Check if it's a Solemnity, Feast or other special day
    if (dayText.toLowerCase().includes('solemnity')) {
        readingInfo.rank = 'Solemnity';
    } else if (dayText.toLowerCase().includes('feast')) {
        readingInfo.rank = 'Feast';
    }

    // Determine season based on context
    if (dayText.toLowerCase().includes('advent')) {
        readingInfo.season = 'ADVENT';
        
        // Extract week number for Advent Sundays
        const weekMatch = dayText.match(/(\d+)(?:st|nd|rd|th)\s+Sunday\s+of\s+Advent/i);
        if (weekMatch) {
            readingInfo.weekNumber = parseInt(weekMatch[1]);
            readingInfo.dayOfWeek = 'Sunday';
        }
    } else if (dayText.toLowerCase().includes('christmas') || 
              dayText.toLowerCase().includes('nativity') ||
              dayText.toLowerCase().includes('holy family') ||
              dayText.toLowerCase().includes('mother of god') ||
              dayText.toLowerCase().includes('epiphany') ||
              dayText.toLowerCase().includes('baptism of the lord')) {
        readingInfo.season = 'CHRISTMAS_TIME';
    }
    
    // Check for vigil masses or other special mass times
    if (dayText.toLowerCase().includes('vigil')) {
        readingInfo.isVigil = true;
    }
    
    // Identify specific Christmas season feasts
    if (dayText.toLowerCase().includes('nativity of the lord') || dayText.toLowerCase().includes('christmas')) {
        // Handle different masses for Christmas
        if (dayText.toLowerCase().includes('vigil')) {
            readingInfo.identifier = 'christmas_vigil';
        } else if (dayText.toLowerCase().includes('night')) {
            readingInfo.identifier = 'christmas_night';
        } else if (dayText.toLowerCase().includes('dawn')) {
            readingInfo.identifier = 'christmas_dawn';
        } else if (dayText.toLowerCase().includes('day')) {
            readingInfo.identifier = 'christmas_day';
        } else {
            readingInfo.identifier = 'christmas';
        }
    } 
    else if (dayText.toLowerCase().includes('holy family')) {
        readingInfo.identifier = 'holy_family';
    }
    else if (dayText.toLowerCase().includes('mary, the mother of god') || dayText.toLowerCase().includes('mother of god')) {
        readingInfo.identifier = 'mary_mother_of_god';
    }
    else if (dayText.toLowerCase().includes('epiphany')) {
        readingInfo.identifier = 'epiphany';
    }
    else if (dayText.toLowerCase().includes('baptism of the lord')) {
        readingInfo.identifier = 'baptism_of_the_lord';
    }
    
    // Process readings and add them to the appropriate data structures
    if (firstReading && firstReading !== '(no bibl. ref.)') {
        // Strip out annotations like "- Vg (diff)" or "(new)"
        const cleanReference = firstReading.replace(/\s*-\s*Vg.*|\(.*?\)/g, '').trim();
        const processed = processReference(cleanReference);
        if (processed) {
            readingInfo.readings.first_reading.push({
                osis: processed.osis,
                reference: cleanReference
            });
        }
    }
    
    if (psalm && psalm !== '(no bibl. ref.)') {
        const cleanReference = psalm.replace(/\s*\(.*?\)/g, '').trim();
        const processed = processReference(cleanReference);
        if (processed) {
            readingInfo.readings.responsorial_psalm.push({
                osis: processed.osis,
                reference: cleanReference
            });
        }
    }
    
    if (secondReading && secondReading !== '(no bibl. ref.)') {
        // Handle multiple reading options separated by "or"
        const options = secondReading.split(/\s+or\s+/i);
        for (const option of options) {
            const cleanReference = option.replace(/\s*\(.*?\)/g, '').trim();
            if (cleanReference) {
                const processed = processReference(cleanReference);
                if (processed) {
                    readingInfo.readings.second_reading.push({
                        osis: processed.osis,
                        reference: cleanReference
                    });
                }
            }
        }
    }
    
    if (alleluia && alleluia !== '(no bibl. ref.)') {
        const cleanReference = alleluia.replace(/\s*\(.*?\)/g, '').trim();
        const processed = processReference(cleanReference);
        if (processed) {
            readingInfo.readings.gospel_acclamation.push({
                osis: processed.osis,
                reference: cleanReference
            });
        }
    }
    
    if (gospel && gospel !== '(no bibl. ref.)') {
        // Look for alternative readings with "or" in the text
        const gospelOptions = gospel.split(/\s+or\s+/i);
        
        for (const option of gospelOptions) {
            const cleanReference = option.replace(/\s*\(.*?\)/g, '').trim();
            if (cleanReference) {
                const processed = processReference(cleanReference);
                if (processed) {
                    readingInfo.readings.gospel.push({
                        osis: processed.osis,
                        reference: cleanReference
                    });
                }
            }
        }
    }

    console.log('Processed reading row:', { 
        feastName: readingInfo.feastName, 
        date: readingInfo.date,
        identifier: readingInfo.identifier,
        season: readingInfo.season,
        cycle: cycle 
    });

    // Initialize the cycle array if needed
    if (!readings[cycle]) {
        readings[cycle] = [];
    }
    
    // Add the reading data to the appropriate cycle
    readings[cycle].push(readingInfo);
}

// Helper function to find matching romcal day
function findMatchingRomcalDay(romcalCalendar, date, season, weekNumber, dayOfWeek, cycle, identifier) {
    console.log(`Looking for match:`, { date, season, weekNumber, dayOfWeek, cycle, identifier });
    
    // If we have a specific identifier for a feast, try to match it directly
    if (identifier) {
        // Map our identifiers to romcal IDs
        const idMap = {
            'christmas_vigil': 'christmas_vigil',
            'christmas_night': 'christmas_1',
            'christmas_dawn': 'christmas_2',
            'christmas_day': 'christmas_3',
            'christmas': 'christmas',
            'holy_family': 'holy_family',
            'mary_mother_of_god': 'mary_mother_of_god',
            'epiphany': 'epiphany',
            'baptism_of_the_lord': 'baptism_of_the_lord'
        };
        
        const romcalId = idMap[identifier];
        if (romcalId) {
            // Search for this ID in the calendar
            for (const [romcalDate, days] of Object.entries(romcalCalendar)) {
                const day = days[0];
                
                // Match by ID
                if (day.id === romcalId || day.id.includes(romcalId)) {
                    console.log(`Found direct match by identifier! ID: ${day.id}`);
                    return day;
                }
            }
        }
    }
    
    // If we have a date, try to match by date (helpful for fixed-date feasts)
    if (date) {
        // Format the date to match romcal format (YYYY-MM-DD)
        const dateParts = date.split('-');
        if (dateParts.length === 2) {
            const month = dateParts[0];
            const day = dateParts[1];
            const year = '2025'; // The year we're using for the calendar
            
            const formattedDate = `${year}-${month}-${day}`;
            
            // Check if this date exists in the calendar
            if (romcalCalendar[formattedDate]) {
                const romcalDay = romcalCalendar[formattedDate][0];
                console.log(`Found match by date! ID: ${romcalDay.id}`);
                return romcalDay;
            }
        }
    }
    
    // Normalize season name to match romcal format
    const normalizedSeason = season ? season.toUpperCase() : null;
    
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
            if (romcalSeason && romcalWeek && normalizedSeason && 
                romcalSeason === normalizedSeason &&
                romcalWeek === parseInt(weekNumber) &&
                romcalCycle === cycle) {
                console.log(`Found exact match! ID: ${day.id}`);
                return day;
            }
        }
    }
    
    // If no exact match found but we have a season, try to find the closest match
    if (normalizedSeason) {
        // Try to find match by season and week number
        for (const [romcalDate, days] of Object.entries(romcalCalendar)) {
            const day = days[0];
            if (day.calendar?.dayOfWeek === 0) {
                const romcalSeason = day.seasons?.[0];
                const romcalWeek = day.calendar?.weekOfSeason;
                
                // Match based on season and week number only
                if (romcalSeason === normalizedSeason &&
                    romcalWeek === parseInt(weekNumber)) {
                    console.log(`Found partial match by season and week! ID: ${day.id}`);
                    return day;
                }
            }
        
            // If still no match, try to find match by name and season
            for (const [romcalDate, days] of Object.entries(romcalCalendar)) {
                const day = days[0];
                const romcalSeason = day.seasons?.[0];
                
                // If the season matches and the name contains our feast name (if provided)
                if (romcalSeason === normalizedSeason && 
                    (identifier && day.id.toLowerCase().includes(identifier.toLowerCase()))) {
                    console.log(`Found match by season and name! ID: ${day.id}`);
                    return day;
                } else if (romcalSeason === normalizedSeason) {
                    console.log(`Found partial match by season! ID: ${day.id}`);
                    return day;
                }
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
                    cycle,
                    reading.identifier
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
                const liturgicalDay = {
                    identifier: day.id,
                    name: day.name,
                    season: day.seasons?.[0] || null,
                    week: day.calendar?.weekOfSeason || null,
                    dayOfWeek: day.calendar?.dayOfWeek || null,
                    date: day.date ? normalizeDate(day.date) : null,
                    rank: day.rankName || null,
                    hasVigil: false,
                    readings: {
                        first_reading: [],
                        responsorial_psalm: [],
                        second_reading: [],
                        gospel_acclamation: [],
                        gospel: []
                    }
                };
                output.cycles.weekdays[cycle].push(liturgicalDay);
                console.log(`Added weekday with ID: ${liturgicalDay.identifier}`);
                
            } else if (day.fromCalendarId === 'properOfSaints') {
                const liturgicalDay = {
                    identifier: day.id,
                    name: day.name,
                    season: day.seasons?.[0] || null,
                    week: day.calendar?.weekOfSeason || null,
                    dayOfWeek: day.calendar?.dayOfWeek || null,
                    date: day.date ? normalizeDate(day.date) : null,
                    rank: day.rankName || null,
                    hasVigil: false,
                    readings: {
                        first_reading: [],
                        responsorial_psalm: [],
                        second_reading: [],
                        gospel_acclamation: [],
                        gospel: []
                    }
                };
                output.properOfSaints.push(liturgicalDay);
                console.log(`Added proper of saints with ID: ${liturgicalDay.identifier}`);
            } else if (day.fromCalendarId === 'commons') {
                const liturgicalDay = {
                    identifier: day.id,
                    name: day.name,
                    season: day.seasons?.[0] || null,
                    week: day.calendar?.weekOfSeason || null,
                    dayOfWeek: day.calendar?.dayOfWeek || null,
                    date: day.date ? normalizeDate(day.date) : null,
                    rank: day.rankName || null,
                    hasVigil: false,
                    readings: {
                        first_reading: [],
                        responsorial_psalm: [],
                        second_reading: [],
                        gospel_acclamation: [],
                        gospel: []
                    }
                };
                output.commons.push(liturgicalDay);
                console.log(`Added common with ID: ${liturgicalDay.identifier}`);
            } else if (day.fromCalendarId === 'ritualMasses') {
                const liturgicalDay = {
                    identifier: day.id,
                    name: day.name,
                    season: day.seasons?.[0] || null,
                    week: day.calendar?.weekOfSeason || null,
                    dayOfWeek: day.calendar?.dayOfWeek || null,
                    date: day.date ? normalizeDate(day.date) : null,
                    rank: day.rankName || null,
                    hasVigil: false,
                    readings: {
                        first_reading: [],
                        responsorial_psalm: [],
                        second_reading: [],
                        gospel_acclamation: [],
                        gospel: []
                    }
                };
                output.ritualMasses.push(liturgicalDay);
                console.log(`Added ritual mass with ID: ${liturgicalDay.identifier}`);
            } else if (day.fromCalendarId === 'votiveMasses') {
                const liturgicalDay = {
                    identifier: day.id,
                    name: day.name,
                    season: day.seasons?.[0] || null,
                    week: day.calendar?.weekOfSeason || null,
                    dayOfWeek: day.calendar?.dayOfWeek || null,
                    date: day.date ? normalizeDate(day.date) : null,
                    rank: day.rankName || null,
                    hasVigil: false,
                    readings: {
                        first_reading: [],
                        responsorial_psalm: [],
                        second_reading: [],
                        gospel_acclamation: [],
                        gospel: []
                    }
                };
                output.votiveMasses.push(liturgicalDay);
                console.log(`Added votive mass with ID: ${liturgicalDay.identifier}`);
            } else if (day.fromCalendarId === 'massesForTheDead') {
                const liturgicalDay = {
                    identifier: day.id,
                    name: day.name,
                    season: day.seasons?.[0] || null,
                    week: day.calendar?.weekOfSeason || null,
                    dayOfWeek: day.calendar?.dayOfWeek || null,
                    date: day.date ? normalizeDate(day.date) : null,
                    rank: day.rankName || null,
                    hasVigil: false,
                    readings: {
                        first_reading: [],
                        responsorial_psalm: [],
                        second_reading: [],
                        gospel_acclamation: [],
                        gospel: []
                    }
                };
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