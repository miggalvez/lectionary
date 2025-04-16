# Lectionary Bible Reference Extractor

This tool processes HTML files containing tables of Bible references and converts them into a structured JSON format, matching each set of readings to the correct liturgical day using the [romcal](https://github.com/romcal/romcal) library for the liturgical calendar.

## Features

- Extracts tables from HTML files in the `input` directory
- Processes Bible references into OSIS format using the Bible Passage Reference Parser
- Matches readings to official liturgical days using romcal's generated calendar
- Generates a structured JSON file (`output/lectionary.json`) following the schema in `schemas/lectionary.schema.json`
- Includes all major cycles: Sundays (A/B/C), Weekdays (I/II), Proper of Saints, Commons, Ritual Masses, Votive Masses, and Masses for the Dead

## Installation

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```

## Usage

1. Place your HTML files containing lectionary tables in the `input` directory
2. Run the script:
   ```bash
   npm start
   ```
3. The output JSON file will be generated as `output/lectionary.json`

## Output Format

The generated JSON file follows the schema in `schemas/lectionary.schema.json`. Example structure:

```json
{
  "lectionaryTitle": "USCCB Lectionary (based on 1998)",
  "schemaVersion": "1.1",
  "cycles": {
    "sundays": {
      "A": [ { /* liturgicalDay objects for Year A Sundays */ } ],
      "B": [ { /* Year B Sundays */ } ],
      "C": [ { /* Year C Sundays */ } ]
    },
    "weekdays": {
      "I": [ { /* Weekday Year I */ } ],
      "II": [ { /* Weekday Year II */ } ]
    }
  },
  "properOfSaints": [ { /* fixed-date feasts */ } ],
  "commons": [ { /* common Masses */ } ],
  "ritualMasses": [ { /* ritual Masses */ } ],
  "votiveMasses": [ { /* votive Masses */ } ],
  "massesForTheDead": [ { /* Masses for the Dead */ } ]
}
```

Each `liturgicalDay` object includes:
- `identifier`: Unique romcal ID for the day
- `name`: Liturgical name
- `season`, `week`, `dayOfWeek`, `date`, `rank`, `hasVigil`
- `readings`: Set of readings (first_reading, responsorial_psalm, second_reading, gospel_acclamation, gospel)

## Dependencies

- [romcal](https://github.com/romcal/romcal) - For generating the liturgical calendar and day metadata
- [Bible Passage Reference Parser](https://github.com/openbibleinfo/Bible-Passage-Reference-Parser) - For parsing Bible references
- [Cheerio](https://cheerio.js.org/) - For HTML parsing

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.