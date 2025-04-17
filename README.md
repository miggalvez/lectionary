# Lectionary Bible Reference Extractor

This tool processes CSV files containing tables of Bible references and converts them into a structured JSON format, matching each set of readings to the correct liturgical day using the [romcal](https://github.com/romcal/romcal) library for the liturgical calendar.

## Source of CSV Files

The CSV files processed by this tool contain Bible references for various liturgical days, organized in a table format with columns for:
- Day/Sunday description (e.g., "1st Sunday of Advent - A")
- First Reading
- Responsorial Psalm
- Second Reading
- Gospel Acclamation (which may be labeled as "Alleluia" or "Verse before the Gospel")
- Gospel

## Features

- Extracts readings from CSV files in the `input` directory
- Processes multiple CSV formats (Advent, Christmas, Lent) with different header structures
- Handles special cases like Palm Sunday with cycle-specific readings
- Processes Bible references into both OSIS and standard human-readable formats
- Recognizes and properly formats special annotations like Gospel titles after dashes
- Identifies alternative readings, optional readings, and shorter forms
- Matches readings to official liturgical days using romcal's calendar definitions
- Generates a structured JSON file (`output/lectionary.json`) following the schema in `schemas/lectionary.schema.json`
- Includes Sunday cycles (A/B/C) with proper seasonal organization

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

The tool supports multiple CSV formats with different header structures:

### Standard Format:
```csv
Sunday or Feast - Year,First Reading,Responsorial Psalm,Second Reading,Alleluia,Gospel
1st Sunday of Advent - A,Isa 2:1-5,"Ps 122:1-2, 3-4a, 4b-5, 6-7, 8-9",Rom 13:11-14,Ps 85:8,Matt 24:37-44
```

### Lent Format (with "Verse before the Gospel" instead of "Alleluia"):
```csv
Sunday or Feast,First Reading,Responsorial Psalm,Second Reading,"Verse before the Gospel",Gospel
1st Sunday of Lent – A,Gen 2:7-9; 3:1-7,"Ps 51:3-4, 5-6, 12-13, 14+17","Rom 5:12-19 or 5:12, 17-19",Matt 4:4b,Matt 4:1-11 – Temptation
```

## Special Format Features

The tool intelligently handles several special cases:

1. **Gospel titles** - Gospel readings that include a title after a dash (e.g., "Matt 4:1-11 – Temptation")

2. **Multiple reading options** - References separated by "or" (e.g., "Rom 5:12-19 or 5:12, 17-19")

3. **Palm Sunday special format** - With different readings for cycles A, B, and C:
   ```
   A: Matt 21:1-11
   B: Mark 11:1-10 or John 12:12-16
   C: Luke 19:28-40
   ```

4. **Optional readings** - Marked with "opt:" prefix

5. **Reference composition** - Converting "+" into "," for Bible reference parsing (e.g., "John 11:25a+26" becomes "John 11:25a,26")

## Output Format

The generated JSON file follows the schema in `schemas/lectionary.schema.json`. Example structure:

```json
{
  "lectionaryTitle": "USCCB Lectionary (based on 1998)",
  "schemaVersion": "1.3",
  "cycles": {
    "sundays": {
      "A": [ 
        {
          "identifier": "advent_1_sunday_a",
          "name": "First Sunday of Advent",
          "romcalKey": "advent_1_sunday",
          "season": "ADVENT",
          "week": 1,
          "dayOfWeek": "Sunday",
          "date": null,
          "rank": "Sunday",
          "massType": null,
          "readings": {
            "first_reading": [
              {
                "referenceOsis": "Isa.2.1-Isa.2.5",
                "referenceStandard": "Isa 2:1-5",
                "note": null
              }
            ],
            "responsorial_psalm": [
              {
                "referenceOsis": "Ps.122.1-Ps.122.9",
                "referenceStandard": "Ps 122:1-2, 3-4a, 4b-5, 6-7, 8-9",
                "note": null
              }
            ],
            "second_reading": [
              {
                "referenceOsis": "Rom.13.11-Rom.13.14",
                "referenceStandard": "Rom 13:11-14",
                "note": null
              }
            ],
            "gospel_acclamation": [
              {
                "referenceOsis": "Ps.85.8",
                "referenceStandard": "Ps 85:8",
                "note": null
              }
            ],
            "gospel": [
              {
                "referenceOsis": "Matt.24.37-Matt.24.44",
                "referenceStandard": "Matt 24:37-44",
                "note": null
              }
            ]
          }
        }
      ],
      "B": [ { /* Year B Sundays */ } ],
      "C": [ { /* Year C Sundays */ } ]
    },
    "weekdays": {
      "I": [],
      "II": []
    }
  },
  "properOfSaints": [],
  "commons": [],
  "ritualMasses": [],
  "votiveMasses": [],
  "massesForTheDead": []
}
```

Each `liturgicalDay` object includes:
- `identifier`: Unique identifier for the day (e.g., "advent_1_sunday_a")
- `name`: Liturgical name (e.g., "First Sunday of Advent")
- `romcalKey`: Identifier key from romcal library (e.g., "advent_1_sunday")
- `season`: Liturgical season (e.g., "ADVENT", "CHRISTMAS", "LENT")
- `week`: Week number within the season
- `dayOfWeek`: Always "Sunday" for current implementation
- `date`: Fixed date in MM-DD format (e.g., "01-01" for Mary, Mother of God)
- `rank`: Liturgical rank (e.g., "Sunday", "Feast", "Solemnity")
- `massType`: For special cases like Christmas (e.g., "Vigil Mass", "Mass during the Night")
- `readings`: Set of readings (first_reading, responsorial_psalm, second_reading, gospel_acclamation, gospel)

Each reading contains options with both OSIS and standard reference formats:
```json
{
  "referenceOsis": "Matt.4.1-Matt.4.11",
  "referenceStandard": "Matt 4:1-11",
  "note": "Temptation"
}
```

## Notes Field

The `note` field may contain:
- Gospel titles (e.g., "Temptation", "Samaritan Woman")
- Reading options (e.g., "alternative/option", "optional", "short form")
- Cross-reference information (e.g., "cf.")
- Citations (e.g., "cited in Lk 4:18")
- Multiple notes combined with semicolons

## Dependencies

- [romcal](https://github.com/romcal/romcal) - For generating the liturgical calendar and day metadata
- [Bible Passage Reference Parser](https://github.com/openbibleinfo/Bible-Passage-Reference-Parser) - For parsing Bible references
- [csv-parse](https://csv.js.org/parse/) - For CSV parsing

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.