// A vendor appears once per listed person, or once with no contact.
export const vendorMeetingsShape = {
	rows: {
		"pages[].items[]": {
			key: ["vendor_id", "contact.id"],
			ref: ["ref", "contact.id"],
			sortedBy: [],
		},
		"pages[].items[].possible_meetings[]": {
			key: ["start", "title"],
			sortedBy: [],
		},
	},
	// Each page's openings run a day from when it was read.
	windows: ["pages[].calendar.scheduling"],
};
