# Documents

```mermaid
---
config:
  layout: elk
  er:
    nodeSpacing: 22
    rankSpacing: 44
---
erDiagram
  "Document"
  "Document extraction"
  "Document kind"
  "Party document"
  "Document" }o--o| "Document" : "supersedes ID, deal ID, kind, previous version#160;#160;#160;#160;"
  "Document" }o--o| "Document kind" : "kind"
  "Document extraction" }o--|| "Document" : "document ID, deal ID"
  "Party document" }o--|| "Document" : "document ID"
```

## Tables

- [Document](next.document.md)
- [Document extraction](next.document_extraction.md)
- [Document kind](next.document_kind.md)
- [Party document](next.party_document.md)

See each table for its columns and links to other areas.
