# Industry and company knowledge

The partners need one deal workflow they can use for every client. The deal page shows the common to-dos for the deal, any additions that apply to this practice, and the source and date behind the numbers they use. Ask Doc reads the same approved material. A partner can review and release a copy for the client.

This is the proposed drawing for [#1519](https://github.com/DoctorCRE/doctorcre-engine/issues/1519). Build starts after the owner approves it and settles the [questions](questions.md). The first use is the existing deal workflow, with rules of thumb, market observations, and lender program terms attached to its to-dos. A lesson can help explain a choice. An approved rule takes its own revision and approval.

## What exists today

| Today | What the drawing connects |
| --- | --- |
| The deal checklist has a fixed order and ticks to-dos from deal evidence. The Plan uses that order and `typical_length`. | Store the ordered workflow while keeping the to-do slugs, recorded evidence, timing inputs, and the existing completion checks. [Checklist and Plan](../new-database.md#checklist-under-the-phases) |
| Client and vendor practice types are recorded as text. Vendor loan programs have names and a vendor role. | Link recorded practice types to a shared vocabulary and attach sourced terms to named programs. [Client practice types](../new-database.md#copying-todays-client-research-and-practice-types) · [Vendors](../new-database.md#vendors) |
| CARR keeps doctrine, conventions, guidance, and lessons in several stores. | Give business knowledge a home in `next` and preserve old source keys. [Import](import.md) |
| The proposed Doc playbooks describe how Doc reads a deal, chooses evidence, and asks for confirmation. | Keep those instructions in the engine checkout and give Doc the current workflow through the engine read. [Doc playbooks](https://github.com/DoctorCRE/doctorcre-engine/blob/93a4540bac1848f4f0b33d985b31918c8502b1db/docs/doc-harness/playbooks.md) · [Doc memory](https://github.com/DoctorCRE/doctorcre-engine/blob/93a4540bac1848f4f0b33d985b31918c8502b1db/docs/doc-harness/memory.md) |

[Client playbooks #198](https://github.com/DoctorCRE/doctorcre-engine/issues/198) describes assembling the playbook from recorded traits each time it opens. Store the knowledge, sources, progress and exceptions as rows. Store the exact version of each item and the exact content when a partner prepares a copy for release.

[Tables and constraints](tables.md) · [What people and jobs read](reads.md) · [Import](import.md) · [Build slices and expected results](slices.md) · [Owner questions](questions.md)
