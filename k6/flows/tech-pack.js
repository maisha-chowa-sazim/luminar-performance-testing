import http from 'k6/http';
import { check } from 'k6';
import { getApiUrl, tenantHeaders } from '../helpers/http.js';

const techPackFixture = JSON.parse(open('../data/tech-pack.json'));

function createTestPdf() {
    const stream = 'BT /F1 12 Tf 10 50 Td (k6 tech pack smoke fixture) Tj ET\n';
    const objects = [
        '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
        '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
        '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
        `4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}endstream\nendobj\n`,
        '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [0];

    for (const object of objects) {
        offsets.push(pdf.length);
        pdf += object;
    }

    const xrefOffset = pdf.length;
    pdf += 'xref\n0 6\n0000000000 65535 f \n';
    for (let index = 1; index < offsets.length; index += 1) {
        pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

    return pdf;
}

export function createTechPack(token, styleId) {
    const hasStyleId = check(styleId, {
        'tech pack style ID is provided': (value) => typeof value === 'string' && value.length > 0,
    });

    if (!hasStyleId) {
        console.error('Tech pack create skipped: pass the ID of a newly created style.');
        return null;
    }

    const uploadUrlsResp = http.post(
        getApiUrl(`/api/v1/styles/${styleId}/tech-packs/upload-urls`),
        JSON.stringify({
            files: techPackFixture.files.map(({ fileName, contentType }) => ({ fileName, contentType })),
        }),
        {
            headers: tenantHeaders(token),
            tags: { feature: 'tech-pack', endpoint: 'createUploadUrls', name: 'tech_pack_upload_urls' },
        },
    );

    const uploadUrlsOk = check(uploadUrlsResp, {
        'tech pack upload URL status is 201': (r) => r.status === 201,
        'tech pack upload URL response is successful': (r) => {
            try {
                return r.json()?.success === true;
            } catch (err) {
                return false;
            }
        },
    });

    if (!uploadUrlsOk) {
        console.error(`Tech pack upload URL request failed: ${uploadUrlsResp.status} ${uploadUrlsResp.body}`);
        return null;
    }

    const uploadInfo = uploadUrlsResp.json()?.data?.[0];
    const file = techPackFixture.files[0];
    if (!uploadInfo?.uploadUrl || !uploadInfo?.fileKey || !uploadInfo?.fields) {
        console.error(`Tech pack upload URL response is missing upload details: ${uploadUrlsResp.body}`);
        return null;
    }

    const uploadResp = http.post(uploadInfo.uploadUrl, {
        ...uploadInfo.fields,
        file: http.file(createTestPdf(), file.fileName, file.contentType),
    }, {
        tags: { feature: 'tech-pack', endpoint: 'uploadTechPackFile', name: 'tech_pack_file_upload' },
    });

    const uploadOk = check(uploadResp, {
        'tech pack file upload status is successful': (r) => [200, 201, 204].includes(r.status),
    });

    if (!uploadOk) {
        console.error(`Tech pack file upload failed: ${uploadResp.status} ${uploadResp.body}`);
        return null;
    }

    const payload = {
        files: [{
            type: file.type,
            fileKey: uploadInfo.fileKey,
            fileName: file.fileName,
        }],
    };
    const resp = http.post(
        getApiUrl(`/api/v1/styles/${styleId}/tech-packs`),
        JSON.stringify(payload),
        {
            headers: tenantHeaders(token),
            tags: { feature: 'tech-pack', endpoint: 'createTechPack', name: 'tech_pack_create' },
        },
    );

    const ok = check(resp, {
        'tech pack create status is 201': (r) => r.status === 201,
        'tech pack create returns success payload': (r) => {
            try {
                return r.json()?.success === true || r.json()?.message === 'Tech pack created successfully';
            } catch (err) {
                return false;
            }
        },
    });

    if (!ok) {
        console.error(`Tech pack create failed: ${resp.status} ${resp.body}`);
    }

    return resp;
}