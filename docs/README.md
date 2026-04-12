# ss-console Docs

Documentation for the SMD Services client portal (ss-console). This is a spoke repo - the canonical enterprise docs live in crane-console and are fetched via `crane_doc`.

## Directory Index

| Directory                                      | Description                                                       |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| [adr/](./adr/index.md)                         | Architecture Decision Records - strategic and technical decisions |
| [collateral/](./collateral/index.md)           | Sales and marketing collateral                                    |
| [design/](./design/index.md)                   | Functional design specifications and UX docs                      |
| [handoffs/](./handoffs/index.md)               | Session handoff records                                           |
| [lead-automation/](./lead-automation/index.md) | Lead automation pipelines and integration specs                   |
| [pm/](./pm/index.md)                           | Product requirements and PRDs                                     |
| [process/](./process/index.md)                 | Project instructions and operational workflows                    |
| [reviews/](./reviews/index.md)                 | Code review and platform audit records                            |
| [spikes/](./spikes/index.md)                   | Technical research spikes and feasibility investigations          |
| [templates/](./templates/index.md)             | Document and deliverable templates                                |
| [wireframes/](./wireframes/index.md)           | UI wireframes                                                     |

## Notes

- The canonical design spec is not stored here. Fetch it at runtime: `crane_doc('ss', 'design-spec.md')`.
- Session handoffs are stored in `handoffs/` - one file per session, named by date.
