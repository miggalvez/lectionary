# Lectionary Bible Reference Extractor

This tool processes HTML files containing CSV tables of Bible references and converts them into a structured JSON format using the Bible Passage Reference Parser library.

## Features

- Extracts CSV tables from HTML files
- Processes Bible references into OSIS format using the Bible Passage Reference Parser
- Generates structured JSON output with formatted references

## Installation

1. Clone this repository
2. Install dependencies:
```bash
npm install
```

## Usage

1. Place your HTML files containing CSV tables in the `input` directory
2. Run the script:
```bash
npm start
```
3. The output JSON file will be generated in the `output` directory

## Output Format

The generated JSON file follows this structure:
```json
{
  "YEAR_1": {
    "ordinary_time_1_wednesday": {
      "firstReading": {
        "range": ["Heb.2.14", "Heb.2.15", ...],
        "osis": "Heb.2.14-Heb.2.18",
        "formatted": "Hebrews 2:14–18"
      },
      "responsorialPsalm": {...},
      "gospel": {...}
    }
  }
}
```

## Dependencies

- [Bible Passage Reference Parser](https://github.com/openbibleinfo/Bible-Passage-Reference-Parser) - For parsing Bible references
- [Cheerio](https://cheerio.js.org/) - For HTML parsing
- [csv-parse](https://csv.js.org/parse/) - For CSV parsing 