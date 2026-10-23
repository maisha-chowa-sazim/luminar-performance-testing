import http from 'k6/http';
import { check } from 'k6';
import { getApiUrl, tenantHeaders } from '../helpers/http.js';

const techPackFixture = JSON.parse(open('../data/tech-pack.json'));
const techPackFiles = techPackFixture.files.map((file) => ({
    ...file,
    contents: open(`../data/techpack/${file.fileName}`, 'b'),
}));

function encodeMultipartText(value) {
    const text = String(value);
    const bytes = new Uint8Array(text.length);

    for (let index = 0; index < text.length; index += 1) {
        bytes[index] = text.charCodeAt(index);
    }

    return bytes;
}

function buildMultipartBody(fields, file, boundary) {
    const chunks = Object.entries(fields).map(([name, value]) => encodeMultipartText(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    ));
    chunks.push(encodeMultipartText(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.fileName}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
    ));
    chunks.push(new Uint8Array(file.contents));
    chunks.push(encodeMultipartText(`\r\n--${boundary}--\r\n`));

    const body = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
    let offset = 0;

    for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.length;
    }

    return body.buffer;
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
            files: techPackFiles.map(({ fileName, contentType }) => ({ fileName, contentType })),
        }),
        {
            headers: tenantHeaders(token),
            tags: { workload: 'techpack', feature: 'tech-pack', endpoint: 'createUploadUrls', name: 'tech_pack_upload_urls' },
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
        console.error(`Tech pack upload URL request failed: ${uploadUrlsResp.status} [response redacted]`);
        return uploadUrlsResp;
    }

    const uploadInfos = uploadUrlsResp.json()?.data;
    if (!Array.isArray(uploadInfos) || uploadInfos.length !== techPackFiles.length) {
        console.error(`Tech pack upload URL response count did not match requested files: [response redacted]`);
        return null;
    }

    const uploadedFiles = [];
    for (const file of techPackFiles) {
        const uploadInfo = uploadInfos.find((info) => info.fileName === file.fileName);
        if (!uploadInfo?.uploadUrl || !uploadInfo?.fileKey || !uploadInfo?.fields) {
            console.error(`Tech pack upload URL response is missing fields for ${file.fileName}`);
            return null;
        }

        const boundary = `k6-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const uploadResp = http.post(uploadInfo.uploadUrl, buildMultipartBody(uploadInfo.fields, file, boundary), {
            headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
            tags: { workload: 'techpack', feature: 'tech-pack', endpoint: 'uploadTechPackFile', name: 'tech_pack_file_upload' },
        });

        const uploadOk = check(uploadResp, {
            [`tech pack upload succeeded: ${file.fileName}`]: (r) => [200, 201, 204].includes(r.status),
        });

        if (!uploadOk) {
            console.error(`Tech pack file upload failed for ${file.fileName}: ${uploadResp.status} [response redacted]`);
            const message = uploadResp.status === 0
                ? (uploadResp.error_code === 1050 || /timeout/i.test(uploadResp.error || '') ? 'request timeout' : 'Upload transport failure; no HTTP response received')
                : `Storage upload returned HTTP ${uploadResp.status}`;
            throw Object.assign(new Error(message), {
                kind: uploadResp.status === 0 ? 'transport_or_script' : 'storage_upload',
                httpStatus: uploadResp.status,
                errorCode: Number.isInteger(uploadResp.error_code) && uploadResp.error_code > 0 ? uploadResp.error_code : undefined,
                uploadFailure: { fileName: file.fileName, message, httpStatus: uploadResp.status,
                    errorCode: uploadResp.error_code || null, count: 1 },
            });
        }

        uploadedFiles.push({
            type: file.type,
            fileKey: uploadInfo.fileKey,
            fileName: file.fileName,
        });
    }

    const payload = {
        files: uploadedFiles,
    };
    const resp = http.post(
        getApiUrl(`/api/v1/styles/${styleId}/tech-packs`),
        JSON.stringify(payload),
        {
            headers: tenantHeaders(token),
            tags: { workload: 'techpack', feature: 'tech-pack', endpoint: 'createTechPack', name: 'tech_pack_create' },
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
        console.error(`Tech pack create failed: ${resp.status} [response redacted]`);
    }

    return resp;
}