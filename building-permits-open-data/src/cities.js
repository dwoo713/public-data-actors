// Registry of Socrata building-permit datasets and their field maps to the
// normalized schema. Every entry was verified against the live SODA endpoint
// (field names and types taken from https://<domain>/api/views/<id>.json).
//
// Privacy rule: map only business / contractor company names. Fields that hold
// an individual's name (owner, applicant, permittee first/last, license holder),
// owner phone numbers or personal emails are never mapped.

const NA_VALUES = new Set(['', 'N/A', 'NA', 'NULL', 'NONE', 'NOT APPLICABLE', 'OWNER', 'OWNER/BUILDER', 'OWNER BUILDER', 'NEEDS CONTACT']);

export function str(v) {
    if (v === null || v === undefined) return null;
    const s = String(v).replace(/\s+/g, ' ').trim();
    return s === '' ? null : s;
}

export function num(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const n = Number(String(v).replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : null;
}

export function company(v) {
    const s = str(v);
    if (!s) return null;
    const cleaned = s.replace(/^"+|"+$/g, '').trim();
    if (NA_VALUES.has(cleaned.toUpperCase())) return null;
    return cleaned;
}

// Business-name heuristic for contractor columns that mix companies and
// licensed individuals (sole proprietors). Returns the name only when it looks
// like a company; an individual's name yields null.
const BUSINESS_WORD_RE = /\b(inc|llc|l\.l\.c|ltd|corp|corporation|co|company|companies|group|enterprises?|associates?|partners?|holdings?|industries|international|intl|services?|solutions?|systems?|construction|constructors?|contractors?|contracting|builders?|building|remodeling|renovations?|restoration|development|developers?|design|designs|electric|electrical|plumbing|plumbers?|heating|cooling|hvac|mechanical|roofing|roofers?|masonry|concrete|paving|painting|landscap\w*|pools?|spas?|solar|energy|glass|windows?|doors?|signs?|sign|fence|fencing|iron|steel|metal|lumber|supply|homes?|housing|realty|properties|property|management|mgmt|engineering|engineers?|architects?|architecture|consulting|consultants?|technologies|tech|communications?|security|fire|sprinkler|elevator|demolition|excavation|excavating|carpentry|cabinets?|flooring|tile|drywall|insulation|siding|gutters?|foundation|trust|church|school|university|hospital|city|county|authority|dept|department|bros|brothers|sons|team|works|usa|america|national|regional|global|the)\b/i;

export function businessOnly(v) {
    const s = company(v);
    if (!s) return null;
    if (BUSINESS_WORD_RE.test(s)) return s;
    if (/[&@0-9]/.test(s)) return s;
    if (/^[A-Za-z'.-]+,\s*[A-Za-z'. -]+$/.test(s)) return null; // "LAST, FIRST M"
    const tokens = s.split(/\s+/);
    if (tokens.length <= 3 && tokens.every((t) => /^[A-Za-z'.-]+$/.test(t))) return null; // "First Last" / "First M Last"
    return s;
}

export function joinAddress(...parts) {
    const s = parts.map(str).filter(Boolean).join(' ').replace(/\s+,/g, ',').trim();
    return s || null;
}

export function pointLat(p) {
    if (!p) return null;
    if (Array.isArray(p.coordinates)) return num(p.coordinates[1]);
    return num(p.latitude);
}

export function pointLon(p) {
    if (!p) return null;
    if (Array.isArray(p.coordinates)) return num(p.coordinates[0]);
    return num(p.longitude);
}

export function urlOf(v) {
    if (!v) return null;
    if (typeof v === 'string') return str(v);
    return str(v.url);
}

// Column names that look like personal data. Used to strip pass-through fields
// in custom mode. Business/company/firm columns are explicitly allowed.
export const PERSONAL_FIELD_RE = /(owner|applicant|permittee|contact|superintendent|licensee|licensed|representative|architect|engineer|filer|requestor|customer|tenant|resident|planmaker|designer|agent|_by$|user)/i;
// Columns whose values may hold either a company or a person; values are kept only when they look like a business.
export const NAME_LIKE_FIELD_RE = /(name|contractor|builder|maker|company|firm|applicant|agent|planner|designer)/i;
export const BUSINESS_FIELD_RE = /(business|company|firm|corp|org|contractor_name|contractorname|contractorcompany)/i;
export const ALWAYS_PERSONAL_RE = /(first_?name|last_?name|middle_?name|full_?name|phone|email|e_mail|_ssn|dob$|birth)/i;

export function looksPersonal(fieldName) {
    if (ALWAYS_PERSONAL_RE.test(fieldName) && !/business/i.test(fieldName)) return true;
    if (PERSONAL_FIELD_RE.test(fieldName) && !BUSINESS_FIELD_RE.test(fieldName)) return true;
    return false;
}

// Chicago lists up to 15 contacts with a type. Pick the first contractor
// contact (never OWNER / ARCHITECT / EXPEDITOR entries).
function chicagoContractor(r) {
    for (let i = 1; i <= 15; i += 1) {
        const type = str(r[`contact_${i}_type`]);
        const name = str(r[`contact_${i}_name`]);
        if (!type || !name) continue;
        const t = type.toUpperCase();
        if (t.includes('CONTRACTOR') && !t.includes('OWNER')) return { name: businessOnly(name), type };
    }
    return { name: null, type: null };
}

export const CITIES = {
    chicago: {
        displayName: 'Chicago, IL',
        city: 'Chicago',
        state: 'IL',
        domain: 'data.cityofchicago.org',
        datasetId: 'ydr8-5enu',
        sourceUrl: 'https://data.cityofchicago.org/d/ydr8-5enu',
        dateField: 'issue_date',
        typeField: 'permit_type',
        costField: 'reported_cost',
        map: (r) => {
            const c = chicagoContractor(r);
            return {
                permitNumber: str(r.permit_),
                permitType: str(r.permit_type),
                permitSubtype: str(r.work_type) ?? str(r.review_type),
                status: str(r.permit_status),
                workDescription: str(r.work_description),
                address: joinAddress(r.street_number, r.street_direction, r.street_name),
                zip: null,
                latitude: num(r.latitude),
                longitude: num(r.longitude),
                appliedDate: r.application_start_date,
                issuedDate: r.issue_date,
                completedDate: null,
                expirationDate: null,
                estimatedCost: num(r.reported_cost),
                fees: num(r.total_fee),
                contractorName: c.name,
                contractorType: c.type,
                contractorLicense: null,
                unitsOrStories: null,
                recordUrl: null,
            };
        },
    },

    nyc: {
        displayName: 'New York City, NY (DOB NOW)',
        city: null, // borough
        state: 'NY',
        domain: 'data.cityofnewyork.us',
        datasetId: 'rbx6-tga4',
        sourceUrl: 'https://data.cityofnewyork.us/d/rbx6-tga4',
        dateField: 'issued_date',
        typeField: 'work_type',
        costField: 'estimated_job_costs',
        costIsText: true,
        map: (r) => ({
            permitNumber: str(r.work_permit) && !/not yet issued/i.test(r.work_permit) ? str(r.work_permit) : str(r.job_filing_number),
            permitType: str(r.work_type),
            permitSubtype: str(r.filing_reason),
            status: str(r.permit_status),
            workDescription: str(r.job_description),
            address: joinAddress(r.house_no, r.street_name),
            city: str(r.borough),
            zip: str(r.zip_code),
            latitude: num(r.latitude),
            longitude: num(r.longitude),
            appliedDate: null,
            approvedDate: r.approved_date,
            issuedDate: r.issued_date,
            completedDate: null,
            expirationDate: r.expired_date,
            estimatedCost: num(r.estimated_job_costs),
            fees: null,
            contractorName: company(r.applicant_business_name),
            contractorLicense: str(r.applicant_license),
            contractorLicenseType: str(r.permittee_s_license_type),
            unitsOrStories: null,
            workOnFloor: str(r.work_on_floor),
            jobFilingNumber: str(r.job_filing_number),
            bin: str(r.bin),
            bbl: str(r.bbl),
            recordUrl: null,
        }),
    },

    nyc_bis: {
        displayName: 'New York City, NY (legacy DOB BIS)',
        city: null,
        state: 'NY',
        domain: 'data.cityofnewyork.us',
        datasetId: 'ipu4-2q9a',
        sourceUrl: 'https://data.cityofnewyork.us/d/ipu4-2q9a',
        dateField: 'issuance_date',
        dateKind: 'textMDY', // stored as MM/DD/YYYY text, not a timestamp
        typeField: 'permit_type',
        costField: null,
        map: (r) => ({
            permitNumber: [str(r.job__), str(r.job_doc___), str(r.permit_sequence__)].filter(Boolean).join('-') || null,
            permitType: str(r.permit_type),
            permitSubtype: str(r.permit_subtype) ?? str(r.work_type),
            status: str(r.permit_status),
            workDescription: null,
            address: joinAddress(r.house__, r.street_name),
            city: str(r.borough),
            zip: str(r.zip_code),
            latitude: num(r.gis_latitude),
            longitude: num(r.gis_longitude),
            appliedDate: r.filing_date,
            issuedDate: r.issuance_date,
            completedDate: null,
            expirationDate: r.expiration_date,
            estimatedCost: null,
            fees: null,
            contractorName: company(r.permittee_s_business_name),
            contractorLicense: str(r.permittee_s_license__),
            contractorLicenseType: str(r.permittee_s_license_type),
            unitsOrStories: null,
            jobType: str(r.job_type),
            bin: str(r.bin__),
            bbl: str(r.bbl),
            recordUrl: null,
        }),
    },

    sf: {
        displayName: 'San Francisco, CA',
        city: 'San Francisco',
        state: 'CA',
        domain: 'data.sf.gov',
        datasetId: 'i98e-djp9',
        sourceUrl: 'https://data.sf.gov/d/i98e-djp9',
        dateField: 'issued_date',
        typeField: 'permit_type_definition',
        costField: 'estimated_cost',
        costIsText: true,
        map: (r) => ({
            permitNumber: str(r.permit_number),
            permitType: str(r.permit_type_definition),
            permitSubtype: str(r.permit_type),
            status: str(r.status),
            workDescription: str(r.description),
            address: joinAddress(joinAddress(r.street_number, r.street_number_suffix), r.street_name, r.street_suffix, r.unit ? `Unit ${str(r.unit)}` : null),
            zip: str(r.zipcode),
            latitude: pointLat(r.location),
            longitude: pointLon(r.location),
            appliedDate: r.filed_date,
            approvedDate: r.approved_date,
            issuedDate: r.issued_date,
            completedDate: r.completed_date,
            expirationDate: null,
            estimatedCost: num(r.estimated_cost),
            revisedCost: num(r.revised_cost),
            fees: null,
            contractorName: null,
            contractorLicense: null,
            unitsOrStories: num(r.proposed_units) ?? num(r.number_of_proposed_stories),
            proposedUnits: num(r.proposed_units),
            proposedStories: num(r.number_of_proposed_stories),
            proposedUse: str(r.proposed_use),
            recordUrl: null,
        }),
    },

    la: {
        displayName: 'Los Angeles, CA',
        city: 'Los Angeles',
        state: 'CA',
        domain: 'data.lacity.org',
        datasetId: 'pi9x-tg5x',
        sourceUrl: 'https://data.lacity.org/d/pi9x-tg5x',
        dateField: 'issue_date',
        typeField: 'permit_type',
        costField: 'valuation',
        costIsText: true,
        map: (r) => ({
            permitNumber: str(r.permit_nbr),
            permitType: str(r.permit_type),
            permitSubtype: str(r.permit_sub_type),
            permitGroup: str(r.permit_group),
            status: str(r.status_desc),
            workDescription: str(r.work_desc),
            address: str(r.primary_address),
            zip: str(r.zip_code),
            latitude: num(r.lat),
            longitude: num(r.lon),
            appliedDate: r.submitted_date,
            issuedDate: r.issue_date,
            completedDate: r.cofo_date,
            expirationDate: null,
            estimatedCost: num(r.valuation),
            fees: null,
            contractorName: null,
            contractorLicense: null,
            unitsOrStories: null,
            useDescription: str(r.use_desc),
            squareFootage: num(r.square_footage),
            recordUrl: null,
        }),
    },

    seattle: {
        displayName: 'Seattle, WA',
        city: 'Seattle',
        state: 'WA',
        domain: 'data.seattle.gov',
        datasetId: '76t5-zqzr',
        sourceUrl: 'https://data.seattle.gov/d/76t5-zqzr',
        dateField: 'issueddate',
        typeField: 'permittypedesc',
        costField: 'estprojectcost',
        map: (r) => ({
            permitNumber: str(r.permitnum),
            permitType: str(r.permittypedesc),
            permitSubtype: str(r.permitclass),
            permitTypeMapped: str(r.permittypemapped),
            status: str(r.statuscurrent),
            workDescription: str(r.description),
            address: str(r.originaladdress1),
            city: str(r.originalcity) ?? 'Seattle',
            state: str(r.originalstate) ?? 'WA',
            zip: str(r.originalzip),
            latitude: num(r.latitude),
            longitude: num(r.longitude),
            appliedDate: r.applieddate,
            issuedDate: r.issueddate,
            completedDate: r.completeddate,
            expirationDate: r.expiresdate,
            estimatedCost: num(r.estprojectcost),
            fees: null,
            contractorName: company(r.contractorcompanyname),
            contractorLicense: null,
            unitsOrStories: num(r.housingunits),
            recordUrl: urlOf(r.link),
        }),
    },

    austin: {
        displayName: 'Austin, TX',
        city: 'Austin',
        state: 'TX',
        domain: 'data.austintexas.gov',
        datasetId: '3syk-w9eu',
        sourceUrl: 'https://data.austintexas.gov/d/3syk-w9eu',
        dateField: 'issue_date',
        typeField: 'permit_type_desc',
        costField: 'total_job_valuation',
        map: (r) => ({
            permitNumber: str(r.permit_number),
            permitType: str(r.permit_type_desc),
            permitSubtype: str(r.work_class),
            permitClass: str(r.permit_class_mapped),
            status: str(r.status_current),
            workDescription: str(r.description),
            address: str(r.original_address1) ?? str(r.permit_location),
            city: str(r.original_city) ?? 'Austin',
            state: str(r.original_state) ?? 'TX',
            zip: str(r.original_zip),
            latitude: num(r.latitude),
            longitude: num(r.longitude),
            appliedDate: r.applieddate,
            issuedDate: r.issue_date,
            completedDate: r.completed_date,
            expirationDate: r.expiresdate,
            estimatedCost: num(r.total_job_valuation) ?? num(r.total_valuation_remodel) ?? sumValuations(r),
            fees: null,
            contractorName: company(r.contractor_company_name),
            contractorTrade: str(r.contractor_trade),
            contractorLicense: null,
            unitsOrStories: num(r.housing_units) ?? num(r.number_of_floors),
            housingUnits: num(r.housing_units),
            numberOfFloors: num(r.number_of_floors),
            recordUrl: urlOf(r.link),
        }),
    },

    cincinnati: {
        displayName: 'Cincinnati, OH',
        city: 'Cincinnati',
        state: 'OH',
        domain: 'data.cincinnati-oh.gov',
        datasetId: 'uhjb-xac9',
        sourceUrl: 'https://data.cincinnati-oh.gov/d/uhjb-xac9',
        dateField: 'issueddate',
        typeField: 'permittypemapped',
        costField: 'estprojectcostdec',
        costIsText: true,
        map: (r) => ({
            permitNumber: str(r.permitnum),
            permitType: str(r.permittypemapped) ?? str(r.permittype),
            permitSubtype: str(r.workclassmapped) ?? str(r.workclass),
            permitTypeCode: str(r.permittype),
            status: str(r.statuscurrentmapped) ?? str(r.statuscurrent),
            workDescription: str(r.description),
            address: str(r.originaladdress1),
            city: str(r.originalcity) ?? 'Cincinnati',
            state: str(r.originalstate) ?? 'OH',
            zip: str(r.originalzip),
            latitude: num(r.latitude),
            longitude: num(r.longitude),
            appliedDate: r.applieddate,
            issuedDate: r.issueddate,
            completedDate: r.completeddate,
            expirationDate: r.expiresdate,
            estimatedCost: num(r.estprojectcostdec),
            fees: num(r.fee),
            contractorName: company(r.companyname),
            contractorLicense: null,
            unitsOrStories: num(r.units),
            totalSqft: num(r.totalsqft),
            recordUrl: str(r.link),
        }),
    },

    mesa: {
        displayName: 'Mesa, AZ',
        city: 'Mesa',
        state: 'AZ',
        domain: 'citydata.mesaaz.gov',
        datasetId: 'dzpk-hxfb',
        sourceUrl: 'https://citydata.mesaaz.gov/d/dzpk-hxfb',
        dateField: 'issued_date',
        typeField: 'permit_type',
        costField: 'total_valuation',
        map: (r) => ({
            permitNumber: str(r.permit_number),
            permitType: str(r.permit_type),
            permitSubtype: str(r.type_of_work),
            recordType: str(r.record_type),
            status: str(r.status),
            workDescription: str(r.description_of_work),
            address: str(r.property_address) ?? joinAddress(r.street_number, r.street_direction, r.street_name, r.street_type),
            zip: null,
            latitude: num(r.latitude),
            longitude: num(r.longitude),
            appliedDate: r.opened_date,
            issuedDate: r.issued_date,
            completedDate: r.finaled_date ?? r.completed_date,
            expirationDate: null,
            estimatedCost: num(r.total_valuation) ?? num(r.job_value),
            fees: num(r.total_fee_assessed),
            contractorName: businessOnly(r.contractor_name),
            contractorLicense: str(r.contractor_license),
            unitsOrStories: num(r.number_of_dwelling_units),
            totalSqft: num(r.total_square_feet),
            recordUrl: null,
        }),
    },

    montgomery_county_md_residential: {
        displayName: 'Montgomery County, MD (residential)',
        city: null,
        state: 'MD',
        domain: 'data.montgomerycountymd.gov',
        datasetId: 'm88u-pqki',
        sourceUrl: 'https://data.montgomerycountymd.gov/d/m88u-pqki',
        dateField: 'issueddate',
        typeField: 'applicationtype',
        costField: 'declaredvaluation',
        map: montgomeryMap,
    },

    montgomery_county_md_commercial: {
        displayName: 'Montgomery County, MD (commercial)',
        city: null,
        state: 'MD',
        domain: 'data.montgomerycountymd.gov',
        datasetId: 'i26v-w6bd',
        sourceUrl: 'https://data.montgomerycountymd.gov/d/i26v-w6bd',
        dateField: 'issueddate',
        typeField: 'applicationtype',
        costField: 'declaredvaluation',
        map: montgomeryMap,
    },

    baton_rouge: {
        displayName: 'East Baton Rouge Parish, LA',
        city: null,
        state: 'LA',
        domain: 'data.brla.gov',
        datasetId: '7fq7-8j7r',
        sourceUrl: 'https://data.brla.gov/d/7fq7-8j7r',
        dateField: 'issueddate',
        typeField: 'permittype',
        costField: 'projectvalue',
        map: (r) => ({
            permitNumber: str(r.permitnumber),
            permitType: str(r.permittype),
            permitSubtype: str(r.designation),
            status: null,
            workDescription: str(r.projectdescription),
            address: str(r.streetaddress) ?? str(r.address),
            city: str(r.city1),
            state: str(r.state1) ?? 'LA',
            zip: str(r.zip),
            latitude: num(r.lat),
            longitude: num(r.long),
            appliedDate: r.creationdate,
            issuedDate: r.issueddate,
            completedDate: null,
            expirationDate: null,
            estimatedCost: num(r.projectvalue),
            fees: num(r.permitfee),
            // Values look like "Company LLC" or "Company LLC - Qualifying Person"; keep the company part only.
            contractorName: businessOnly(str(r.contractorname)?.split(/\s+-\s+/)[0]),
            contractorLicense: null,
            unitsOrStories: null,
            squareFootage: num(r.squarefootage),
            subdivision: str(r.subdivision),
            recordUrl: null,
        }),
    },

    marin_county: {
        displayName: 'Marin County, CA',
        city: null,
        state: 'CA',
        domain: 'data.marincounty.gov',
        datasetId: 'mkbn-caye',
        sourceUrl: 'https://data.marincounty.gov/d/mkbn-caye',
        dateField: 'issued_date',
        typeField: 'type_permit',
        costField: 'construction_value',
        map: (r) => ({
            permitNumber: str(r.permit_number),
            permitType: str(r.type_permit),
            permitSubtype: str(r.permit_work_class) ?? str(r.permit_category),
            permitCategory: str(r.permit_category),
            status: null,
            workDescription: str(r.description) ?? str(r.construction)?.replace(/;\s*$/, ''),
            address: str(r.address)?.replace(/,\s*[A-Z .'-]+,\s*CA\s*\d{5}(-\d{4})?\s*$/i, '') ?? null,
            city: str(r.city_town) ?? str(r.city_town_inferred),
            zip: str(r.zipcode),
            latitude: num(r.latitude),
            longitude: num(r.longitude),
            appliedDate: r.received_date,
            issuedDate: r.issued_date,
            completedDate: null,
            expirationDate: null,
            estimatedCost: num(r.construction_value),
            fees: null,
            contractorName: businessOnly(r.contractor),
            contractorLicense: str(r.contractor_license),
            unitsOrStories: null,
            parcelNumber: str(r.parcel_number),
            recordUrl: null,
        }),
    },

    cambridge: {
        displayName: 'Cambridge, MA (addition/alteration)',
        city: 'Cambridge',
        state: 'MA',
        domain: 'data.cambridgema.gov',
        datasetId: 'qu2z-8suj',
        sourceUrl: 'https://data.cambridgema.gov/d/qu2z-8suj',
        dateField: 'issue_date',
        typeField: 'permit_type',
        costField: 'total_cost',
        map: (r) => ({
            permitNumber: str(r.id_field) ?? str(r.id),
            permitType: str(r.permit_type),
            permitSubtype: str(r.building_use),
            status: str(r.status),
            workDescription: str(r.detailed_description_of_work),
            address: str(r.full_address)?.replace(/,\s*Cambridge,\s*MA\s*\d{5}(-\d{4})?$/i, ''),
            zip: str(r.full_address)?.match(/\b(\d{5})(?:-\d{4})?\s*$/)?.[1] ?? null,
            latitude: num(r.latitude),
            longitude: num(r.longitude),
            appliedDate: r.applicant_submit_date,
            issuedDate: r.issue_date,
            completedDate: null,
            expirationDate: null,
            estimatedCost: num(r.total_cost),
            fees: null,
            contractorName: company(r.firm_name),
            contractorLicense: null,
            unitsOrStories: num(r.number_of_residential_units) ?? num(r.stories_above_grade),
            residentialUnits: num(r.number_of_residential_units),
            storiesAboveGrade: num(r.stories_above_grade),
            recordUrl: null,
        }),
    },
};

// Austin trade permits often leave total_job_valuation empty but fill the per-trade columns.
function sumValuations(r) {
    const parts = ['building_valuation', 'building_valuation_remodel', 'electrical_valuation', 'electrical_valuation_remodel', 'mechanical_valuation', 'mechanical_valuation_remodel', 'plumbing_valuation', 'plumbing_valuation_remodel', 'medgas_valuation', 'medgas_valuation_remodel']
        .map((k) => num(r[k])).filter((v) => v !== null);
    return parts.length ? parts.reduce((a, b) => a + b, 0) : null;
}

function montgomeryMap(r) {
    return {
        permitNumber: str(r.permitno),
        permitType: str(r.applicationtype),
        permitSubtype: str(r.worktype),
        useCode: str(r.usecode),
        status: str(r.status),
        workDescription: str(r.description)?.replace(/^Customer Wants To Use ePlans,?\s*/i, '') ?? null,
        address: joinAddress(r.stno, r.predir, r.stname, r.suffix, r.postdir),
        city: str(r.city),
        state: str(r.state) ?? 'MD',
        zip: str(r.zip),
        latitude: pointLat(r.location),
        longitude: pointLon(r.location),
        appliedDate: r.addeddate,
        issuedDate: r.issueddate,
        completedDate: r.finaleddate,
        expirationDate: null,
        estimatedCost: num(r.declaredvaluation),
        fees: null,
        contractorName: null,
        contractorLicense: null,
        unitsOrStories: null,
        buildingArea: num(r.buildingarea),
        recordUrl: null,
    };
}

// Builds a source definition for the `custom` input.
export function buildCustomSource(custom) {
    const domain = str(custom?.domain)?.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const datasetId = str(custom?.datasetId);
    if (!domain || !datasetId) throw new Error('custom.domain and custom.datasetId are required');
    if (!/^[a-z0-9]{4}-[a-z0-9]{4}$/i.test(datasetId)) throw new Error(`custom.datasetId "${datasetId}" is not a Socrata dataset id (expected xxxx-xxxx)`);
    const fieldMap = custom.fieldMap && typeof custom.fieldMap === 'object' ? custom.fieldMap : {};
    const mapped = new Set(Object.values(fieldMap).filter((v) => typeof v === 'string'));
    const DATE_KEYS = new Set(['appliedDate', 'issuedDate', 'completedDate', 'expirationDate']);
    const NUM_KEYS = new Set(['estimatedCost', 'fees', 'latitude', 'longitude', 'unitsOrStories']);

    return {
        key: 'custom',
        displayName: str(custom.displayName) ?? `${domain}/${datasetId}`,
        city: str(custom.city),
        state: str(custom.state),
        domain,
        datasetId,
        sourceUrl: `https://${domain}/d/${datasetId}`,
        dateField: typeof fieldMap.issuedDate === 'string' ? fieldMap.issuedDate : null,
        dateKind: custom.dateKind === 'textMDY' ? 'textMDY' : 'timestamp',
        typeField: typeof fieldMap.permitType === 'string' ? fieldMap.permitType : null,
        costField: typeof fieldMap.estimatedCost === 'string' ? fieldMap.estimatedCost : null,
        costIsText: Boolean(custom.costIsText),
        isCustom: true,
        map: (r) => {
            const out = {};
            // pass through everything that is not mapped and does not look personal
            for (const [k, v] of Object.entries(r)) {
                if (k.startsWith(':@') || mapped.has(k) || looksPersonal(k)) continue;
                if (typeof v === 'string' && NAME_LIKE_FIELD_RE.test(k)) {
                    const b = businessOnly(v);
                    if (b === null) continue; // individual's name or empty: never passed through
                    out[k] = b;
                    continue;
                }
                out[k] = v;
            }
            for (const [normKey, srcField] of Object.entries(fieldMap)) {
                if (typeof srcField !== 'string') continue;
                const v = r[srcField];
                if (DATE_KEYS.has(normKey)) out[normKey] = v ?? null;
                else if (NUM_KEYS.has(normKey)) out[normKey] = num(v);
                else if (normKey === 'contractorName') out[normKey] = company(v);
                else if (v && typeof v === 'object') out[normKey] = v.url ?? v;
                else out[normKey] = str(v);
            }
            if (!('latitude' in out) && r.location) { out.latitude = pointLat(r.location); out.longitude = pointLon(r.location); }
            return out;
        },
    };
}
