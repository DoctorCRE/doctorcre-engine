# Property

```mermaid
---
config:
  layout: elk
  er:
    nodeSpacing: 22
    rankSpacing: 44
---
erDiagram
  "Building ownership"
  "Deal property"
  "Measurement"
  "Property"
  "Space need"
  "Suite"
  "Building ownership" }o--|| "Property" : "property ID"
  "Deal property" }o--|| "Property" : "property ID"
  "Suite" }o--|| "Property" : "property ID"
```

## Tables

- [Building ownership](next.building_ownership.md)
- [Deal property](next.deal_property.md)
- [Measurement](next.measurement.md)
- [Property](next.property.md)
- [Space need](next.space_need.md)
- [Suite](next.suite.md)

See each table for its columns and links to other areas.
