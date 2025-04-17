# Lectionary Bible Reference Extractor

This tool processes CSV files containing tables of Bible references and converts them into a structured JSON format, matching each set of readings to the correct liturgical day using the [romcal](https://github.com/romcal/romcal) library for the liturgical calendar.

## Source of CSV Files

The CSV files processed by this tool contain Bible references for various liturgical days, organized in a table format with columns for:
- Day/Sunday description (e.g., "1st Sunday of Advent - A")
- First Reading
- Responsorial Psalm
- Second Reading
- Alleluia Verse
- Gospel

## Features

- Extracts readings from CSV files in the `input` directory
- Processes Bible references into both OSIS and standard human-readable formats
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

1. Place your CSV files containing lectionary tables in the `input` directory
2. Run the script:
   ```bash
   npm start
   ```
3. The output JSON file will be generated as `output/lectionary.json`

## CSV Format

The expected CSV format includes headers and follows this structure:

```csv
Sunday,First Reading,Responsorial Psalm,Second Reading,Alleluia Verse,Gospel
1st Sunday of Advent - A,Isa 2:1-5,"Ps 122:1-2, 3-4a, 4b-5, 6-7, 8-9",Rom 13:11-14,Ps 85:8,Matt 24:37-44
```

## Output Format

The generated JSON file follows the schema in `schemas/lectionary.schema.json`. Example structure:

```json
{
  "lectionaryTitle": "USCCB Lectionary (based on 1998)",
  "schemaVersion": "1.3",
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
- `identifier`: Unique identifier for the day
- `name`: Liturgical name
- `romcalKey`: Identifier key from romcal library
- `season`, `week`, `dayOfWeek`, `date`, `rank`, `massType`
- `readings`: Set of readings (first_reading, responsorial_psalm, second_reading, gospel_acclamation, gospel)

Each reading contains options with both OSIS and standard reference formats:
```json
{
  "referenceOsis": "Gen.1.1-Gen.2.2",
  "referenceStandard": "Genesis 1:1-2:2",
  "note": "short form"
}
```

## Dependencies

- [romcal](https://github.com/romcal/romcal) - For generating the liturgical calendar and day metadata
- [Bible Passage Reference Parser](https://github.com/openbibleinfo/Bible-Passage-Reference-Parser) - For parsing Bible references
- [csv-parse](https://csv.js.org/parse/) - For CSV parsing

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.