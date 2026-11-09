import * as opaque from '@serenity-kit/opaque';
import { BrowserQRCodeReader } from '@zxing/browser';
import QRCode from 'qrcode';

const maximumTransferSize = 50 * 1024 * 1024;
const selectedFiles = [];
const fileInput = document.getElementById('file-upload');
const dropZone = document.getElementById('drop-zone');
const uploadButton = document.getElementById('upload-btn');
const fileList = document.getElementById('file-list');
const uploadInfo = document.getElementById('upload-info');
const transferModal = document.getElementById('transfer-completed');
const uploadStatus = document.getElementById('upload-status');
const uploadProgress = document.getElementById('upload-progress');
const receiveStatus = document.getElementById('receive-status');
const receiveProgress = document.getElementById('receive-progress');
const receiveResults = document.getElementById('receive-results');
let currentTransfer;
let cameraControls;
let decryptedFiles = [];
let countdownInterval;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encodeBase64Url(value) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function decodeBase64Url(value) {
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
    return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} bytes`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function typeLabel(filename) {
    const extension = filename.split('.').pop()?.toUpperCase() ?? 'FILE';
    return extension.length <= 4 ? extension : 'FILE';
}

function setMessage(element, message, isError = false) {
    element.textContent = message;
    element.classList.toggle('text-error', isError);
    element.classList.toggle('text-success', !isError && Boolean(message));
}

async function request(path, options = {}) {
    let response;
    try {
        response = await fetch(`/api${path}`, {
            ...options,
            headers: { ...(options.headers ?? {}), ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) },
        });
    } catch {
        throw new Error('SecureShare API is unavailable. Check your connection and try again.');
    }

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        const message = Array.isArray(result.message) ? result.message.join(' ') : result.message;
        throw new Error(message || `Request failed (${response.status})`);
    }
    return result;
}

function renderSelectedFiles() {
    const total = selectedFiles.reduce((sum, file) => sum + file.size, 0);
    fileList.replaceChildren();

    selectedFiles.forEach((file, index) => {
        const row = document.createElement('div');
        row.className = 'file-item';
        const badge = document.createElement('span');
        badge.className = 'file-type-badge';
        badge.textContent = typeLabel(file.name);
        badge.setAttribute('aria-hidden', 'true');
        const name = document.createElement('span');
        name.className = 'file-name';
        name.textContent = file.name;
        name.title = file.name;
        const size = document.createElement('span');
        size.className = 'file-size';
        size.textContent = formatSize(file.size);
        const remove = document.createElement('button');
        remove.className = 'btn-remove';
        remove.type = 'button';
        remove.textContent = 'Remove';
        remove.setAttribute('aria-label', `Remove ${file.name}`);
        remove.addEventListener('click', () => {
            selectedFiles.splice(index, 1);
            renderSelectedFiles();
        });
        row.append(badge, name, size, remove);
        fileList.append(row);
    });

    uploadInfo.classList.toggle('hidden', selectedFiles.length === 0);
    document.getElementById('total-size').textContent = formatSize(total);
    document.getElementById('file-count').textContent = `${selectedFiles.length} ${selectedFiles.length === 1 ? 'file' : 'files'}`;
    document.getElementById('remaining-size').textContent = `${formatSize(Math.max(0, maximumTransferSize - total))} remaining`;
    uploadButton.disabled = selectedFiles.length === 0 || total > maximumTransferSize;
}

function addFiles(files) {
    let rejected = 0;
    const existing = new Set(selectedFiles.map(file => `${file.name}:${file.size}:${file.lastModified}`));
    for (const file of files) {
        const identity = `${file.name}:${file.size}:${file.lastModified}`;
        if (existing.has(identity)) continue;
        existing.add(identity);
        const size = selectedFiles.reduce((sum, item) => sum + item.size, 0);
        if (size + file.size > maximumTransferSize) {
            rejected += 1;
            continue;
        }
        selectedFiles.push(file);
    }
    renderSelectedFiles();
    setMessage(uploadStatus, rejected ? `${rejected} file(s) were not added. The transfer limit is 50 MB.` : '');
}

function setProgress(prefix, loaded, total, label) {
    const percent = total ? Math.min(100, Math.floor(loaded / total * 100)) : 0;
    document.getElementById(`${prefix}-progress`).classList.remove('hidden');
    document.getElementById(`${prefix}-progress-label`).textContent = label;
    document.getElementById(`${prefix}-progress-percent`).textContent = `${percent}%`;
    document.getElementById(`${prefix}-progress-bar`).value = percent;
}

function hashKey(purpose, transferId, keyText) {
    const raw = decodeBase64Url(keyText);
    return crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']).then(key =>
        crypto.subtle.deriveKey({
            name: 'HKDF',
            hash: 'SHA-256',
            salt: encoder.encode(transferId),
            info: encoder.encode(`SecureShare ${purpose} v1`),
        }, key, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']),
    );
}

async function encryptJson(key, value) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(value)));
    return JSON.stringify({ iv: encodeBase64Url(iv), ciphertext: encodeBase64Url(ciphertext) });
}

async function decryptJson(key, encryptedValue) {
    const envelope = JSON.parse(encryptedValue);
    const cleartext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: decodeBase64Url(envelope.iv) },
        key,
        decodeBase64Url(envelope.ciphertext),
    );
    return JSON.parse(decoder.decode(cleartext));
}

async function encryptFiles(files, apiFiles, transferId, fileKey) {
    const metadata = [];
    const encryptedFiles = [];
    for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const cleartext = await file.arrayBuffer();
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, fileKey, cleartext);
        const digest = await crypto.subtle.digest('SHA-256', cleartext);
        metadata.push({
            id: apiFiles[index].id,
            name: file.name,
            type: file.type || 'application/octet-stream',
            size: file.size,
            iv: encodeBase64Url(iv),
            sha256: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''),
        });
        encryptedFiles.push({ id: apiFiles[index].id, blob: new Blob([ciphertext], { type: 'application/octet-stream' }) });
        setMessage(uploadStatus, `Encrypting ${index + 1} of ${files.length}: ${file.name}`);
    }
    const encryptedMetadata = await encryptJson(fileKey, { transferId, files: metadata });
    return { metadata, encryptedFiles, encryptedMetadata };
}

function uploadEncryptedFile(transferId, ownerToken, fileId, blob, onProgress) {
    return new Promise((resolve, reject) => {
        const formData = new FormData();
        formData.append('file', blob, 'encrypted.bin');
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `/api/transfers/${transferId}/files/${fileId}`);
        xhr.setRequestHeader('X-Owner-Token', ownerToken);
        xhr.upload.onprogress = event => onProgress(Math.min(event.loaded, blob.size));
        xhr.onerror = () => reject(new Error('Network disconnected during upload.'));
        xhr.onload = () => {
            let result = {};
            try { result = JSON.parse(xhr.responseText); } catch { /* The status still determines success. */ }
            if (xhr.status < 200 || xhr.status >= 300 || result.uploaded !== true) {
                reject(new Error(result.message || `Encrypted upload failed (${xhr.status})`));
                return;
            }
            resolve(result);
        };
        xhr.send(formData);
    });
}

async function beginUpload() {
    if (!selectedFiles.length) {
        setMessage(uploadStatus, 'Choose at least one file to continue.', true);
        return;
    }
    const total = selectedFiles.reduce((sum, file) => sum + file.size, 0);
    const durationDays = Number(document.querySelector('input[name="duration-days"]:checked')?.value ?? 1);
    if (total > maximumTransferSize) {
        setMessage(uploadStatus, 'The total file size exceeds 50 MB.', true);
        return;
    }

    uploadButton.disabled = true;
    uploadProgress.classList.remove('hidden');
    document.getElementById('upload-progress-bar').value = 0;
    document.getElementById('upload-progress-percent').textContent = '0%';
    let transfer;
    try {
        await opaque.ready;
        transfer = await request('/transfers', {
            method: 'POST',
            body: JSON.stringify({ totalSize: total, durationDays, files: selectedFiles.map(file => ({ size: file.size })) }),
        });
        currentTransfer = transfer;

        setMessage(uploadStatus, 'Preparing end-to-end encryption...');
        const { clientRegistrationState, registrationRequest } = opaque.client.startRegistration({ password: transfer.code });
        const { registrationResponse } = await request(`/transfers/${transfer.transferId}/opaque/register/start`, {
            method: 'POST',
            headers: { 'X-Owner-Token': transfer.ownerToken },
            body: JSON.stringify({ registrationRequest }),
        });
        const { registrationRecord, exportKey } = opaque.client.finishRegistration({
            clientRegistrationState,
            registrationResponse,
            password: transfer.code,
        });

        const fileKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
        const rawFileKey = await crypto.subtle.exportKey('raw', fileKey);
        const wrappedKey = await hashKey('key-envelope', transfer.transferId, exportKey);
        const encryptedKeyEnvelope = await encryptJson(wrappedKey, { key: encodeBase64Url(rawFileKey) });
        const encrypted = await encryptFiles(selectedFiles, transfer.files, transfer.transferId, fileKey);
        const uploadTotal = encrypted.encryptedFiles.reduce((sum, file) => sum + file.blob.size, 0);
        let uploaded = 0;

        for (const item of encrypted.encryptedFiles) {
            const name = encrypted.metadata.find(file => file.id === item.id)?.name ?? 'file';
            setMessage(uploadStatus, `Uploading ${name}...`);
            let currentLoaded = 0;
            await uploadEncryptedFile(transfer.transferId, transfer.ownerToken, item.id, item.blob, loaded => {
                currentLoaded = loaded;
                setProgress('upload', uploaded + currentLoaded, uploadTotal, `Uploading ${name}`);
            });
            uploaded += item.blob.size;
            setProgress('upload', uploaded, uploadTotal, 'Encrypted files stored');
        }

        setMessage(uploadStatus, 'Verifying stored encrypted files...');
        const completion = await request(`/transfers/${transfer.transferId}/complete`, {
            method: 'POST',
            headers: { 'X-Owner-Token': transfer.ownerToken },
            body: JSON.stringify({
                registrationRecord,
                encryptedKeyEnvelope,
                encryptedMetadata: encrypted.encryptedMetadata,
            }),
        });
        Object.assign(transfer, {
            uploadedAt: completion.uploadedAt,
            expiresAt: completion.expiresAt,
            durationDays: completion.durationDays,
        });

        currentTransfer.shareUrl = `${location.origin}/receive/${encodeURIComponent(transfer.transferId)}#key=${encodeURIComponent(encodeBase64Url(rawFileKey))}`;
        showTransferSuccess(transfer, encrypted.metadata, total);
        setMessage(uploadStatus, 'Encrypted transfer is ready.');
    } catch (error) {
        if (transfer?.transferId && transfer.ownerToken) {
            await request(`/transfers/${transfer.transferId}`, {
                method: 'DELETE',
                headers: { 'X-Owner-Token': transfer.ownerToken },
            }).catch(() => undefined);
        }
        setMessage(uploadStatus, error instanceof Error ? error.message : 'Upload failed.', true);
        uploadButton.disabled = selectedFiles.length === 0;
    }
}

function showTransferSuccess(transfer, files, total) {
    document.getElementById('transfer-code').textContent = transfer.code;
    document.getElementById('expiration-time').textContent = new Date(transfer.expiresAt).toLocaleString();
    document.getElementById('uploaded-time').textContent = new Date(transfer.uploadedAt).toLocaleString();
    document.getElementById('storage-duration-result').textContent = `${transfer.durationDays} day${transfer.durationDays === 1 ? '' : 's'}`;
    startExpirationCountdown(document.getElementById('expiration-countdown'), transfer.expiresAt);
    document.getElementById('total-size-completed').textContent = formatSize(total);
    const completedList = document.getElementById('file-list-completed');
    completedList.replaceChildren();
    for (const file of files) {
        const row = document.createElement('div');
        row.className = 'file-item';
        const name = document.createElement('span');
        name.textContent = file.name;
        const size = document.createElement('span');
        size.textContent = formatSize(file.size);
        row.append(name, size);
        completedList.append(row);
    }
    QRCode.toCanvas(document.getElementById('qr-canvas'), currentTransfer.shareUrl, { width: 180, margin: 1 })
        .then(() => transferModal.classList.remove('hidden'))
        .catch(() => setMessage(uploadStatus, 'Transfer was stored, but QR generation failed. Copy the secure link instead.', true));
}

function xhrDownload(url, onProgress) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url);
        xhr.responseType = 'arraybuffer';
        xhr.onprogress = event => onProgress(event.loaded, event.lengthComputable ? event.total : undefined);
        xhr.onerror = () => reject(new Error('Network disconnected during download.'));
        xhr.onload = () => {
            if (xhr.status < 200 || xhr.status >= 300) {
                let message = `Encrypted download failed (${xhr.status})`;
                try { message = JSON.parse(decoder.decode(xhr.response)).message || message; } catch { /* Binary error body. */ }
                reject(new Error(message));
                return;
            }
            resolve(new Uint8Array(xhr.response));
        };
        xhr.send();
    });
}

async function unwrapFileKey(manifest, wrappingKey) {
    const envelope = JSON.parse(manifest.encryptedKeyEnvelope);
    const cleartext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: decodeBase64Url(envelope.iv) },
        wrappingKey,
        decodeBase64Url(envelope.ciphertext),
    );
    const wrappedKey = JSON.parse(decoder.decode(cleartext));
    const rawKey = decodeBase64Url(wrappedKey.key);
    if (rawKey.byteLength !== 32) throw new Error('Transfer key envelope is invalid.');
    return crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);
}

async function receiveTransfer(manifest, fileKey) {
    const metadata = await decryptJson(fileKey, manifest.encryptedMetadata);
    if (metadata.transferId !== manifest.transferId || metadata.files.length !== manifest.files.length) {
        throw new Error('Transfer metadata did not match the encrypted file list.');
    }
    const totalEncrypted = manifest.files.reduce((sum, file) => sum + file.encryptedSize, 0);
    let downloaded = 0;
    decryptedFiles = [];
    receiveResults.classList.add('hidden');
    receiveProgress.classList.remove('hidden');

    for (let index = 0; index < manifest.files.length; index += 1) {
        const file = manifest.files[index];
        const details = metadata.files.find(item => item.id === file.id);
        if (!details) throw new Error('Encrypted file metadata is incomplete.');
        setMessage(receiveStatus, `Retrieving ${details.name}...`);
        const ciphertext = await xhrDownload(`/api/transfers/${manifest.transferId}/files/${file.id}`, (loaded, reportedTotal) => {
            const current = Math.min(loaded, reportedTotal ?? file.encryptedSize);
            setProgress('receive', downloaded + current, totalEncrypted, `Retrieving ${details.name}`);
        });
        if (ciphertext.byteLength !== file.encryptedSize) throw new Error(`The encrypted download for ${details.name} was incomplete.`);

        setMessage(receiveStatus, `Decrypting ${index + 1} of ${manifest.files.length}: ${details.name}`);
        const cleartext = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: decodeBase64Url(details.iv) },
            fileKey,
            ciphertext,
        );
        const digest = await crypto.subtle.digest('SHA-256', cleartext);
        const actualHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        if (actualHash !== details.sha256 || cleartext.byteLength !== details.size) {
            throw new Error(`Integrity verification failed for ${details.name}.`);
        }
        decryptedFiles.push({ name: details.name, size: details.size, type: details.type, blob: new Blob([cleartext], { type: details.type }) });
        downloaded += file.encryptedSize;
        setProgress('receive', downloaded, totalEncrypted, `Verified ${index + 1} of ${manifest.files.length}`);
    }

    renderReceiveResults(manifest, metadata);
    for (const file of decryptedFiles) downloadBlob(file);
    setMessage(receiveStatus, 'Files decrypted and integrity-checked. If downloads were blocked, use Download Files below.');
}

function downloadBlob(file) {
    const objectUrl = URL.createObjectURL(file.blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = file.name;
    link.rel = 'noopener';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

function renderReceiveResults(manifest, metadata) {
    receiveResults.replaceChildren();
    const heading = document.createElement('h4');
    heading.className = 'font-bold mb-2';
    heading.textContent = `${decryptedFiles.length} file${decryptedFiles.length === 1 ? '' : 's'} ready · ${formatSize(manifest.totalSize)}`;
    const details = document.createElement('div');
    details.className = 'file-list mb-3';
    for (const file of metadata.files) {
        const row = document.createElement('div');
        row.className = 'file-item';
        const name = document.createElement('span');
        name.className = 'file-name';
        name.textContent = file.name;
        const size = document.createElement('span');
        size.className = 'file-size';
        size.textContent = formatSize(file.size);
        row.append(name, size);
        details.append(row);
    }
    const uploaded = document.createElement('p');
    uploaded.className = 'text-sm text-text-primary/60';
    uploaded.textContent = `Uploaded ${new Date(manifest.uploadedAt).toLocaleString()} · Stored for ${manifest.durationDays} day${manifest.durationDays === 1 ? '' : 's'}`;
    const status = document.createElement('p');
    status.className = 'text-sm text-text-primary/60';
    status.textContent = `Transfer status: ${manifest.status}`;
    const countdown = document.createElement('p');
    countdown.className = 'text-sm font-medium text-primary';
    startExpirationCountdown(countdown, manifest.expiresAt);
    const download = document.createElement('button');
    download.type = 'button';
    download.className = 'btn-primary w-full py-3 rounded-md text-sm font-medium mt-3';
    download.textContent = 'Download Files';
    download.addEventListener('click', () => decryptedFiles.forEach(downloadBlob));
    receiveResults.append(heading, details, uploaded, status, countdown, download);
    receiveResults.classList.remove('hidden');
}

function startExpirationCountdown(element, expiresAt) {
    if (countdownInterval) clearInterval(countdownInterval);
    const expiration = new Date(expiresAt).getTime();
    const update = () => {
        const remaining = Math.max(0, expiration - Date.now());
        if (remaining === 0) {
            element.textContent = 'Transfer expired';
            clearInterval(countdownInterval);
            return;
        }
        const days = Math.floor(remaining / 86_400_000);
        const hours = Math.floor((remaining % 86_400_000) / 3_600_000);
        const minutes = Math.floor((remaining % 3_600_000) / 60_000);
        element.textContent = `Expires in ${days} days, ${hours} hours, ${minutes} minutes`;
    };
    update();
    countdownInterval = setInterval(update, 30_000);
}

async function receiveWithCode() {
    const code = [...document.querySelectorAll('.code-box')].map(input => input.value).join('');
    if (!/^\d{6}$/u.test(code)) {
        setMessage(receiveStatus, 'Enter all six digits of the transfer code.', true);
        return;
    }
    try {
        setMessage(receiveStatus, 'Verifying transfer code...');
        await opaque.ready;
        const { clientLoginState, startLoginRequest } = opaque.client.startLogin({ password: code });
        const started = await request('/receive/code/start', {
            method: 'POST',
            body: JSON.stringify({ code, startLoginRequest }),
        });
        const login = opaque.client.finishLogin({
            clientLoginState,
            loginResponse: started.loginResponse,
            password: code,
        });
        if (!login) throw new Error('Invalid or expired transfer code.');
        const manifest = await request('/receive/code/finish', {
            method: 'POST',
            body: JSON.stringify({ sessionId: started.sessionId, finishLoginRequest: login.finishLoginRequest }),
        });
        const wrappingKey = await hashKey('key-envelope', manifest.transferId, login.exportKey);
        const fileKey = await unwrapFileKey(manifest, wrappingKey);
        await receiveTransfer(manifest, fileKey);
    } catch (error) {
        setMessage(receiveStatus, error instanceof Error ? error.message : 'Could not receive this transfer.', true);
    }
}

function parseSecureLink(value) {
    const url = new URL(value, location.origin);
    if (url.origin !== location.origin) throw new Error('QR code must link to this SecureShare site.');
    const fragment = new URLSearchParams(url.hash.slice(1));
    const routeMatch = url.pathname.match(/^\/receive\/([0-9a-f-]{36})\/?$/iu);
    const transferId = routeMatch?.[1] ?? fragment.get('id');
    const secret = fragment.get('key');
    if (!transferId || !secret || !/^[0-9a-f-]{36}$/iu.test(transferId)) throw new Error('This QR code is not a valid SecureShare transfer.');
    return { transferId, secret };
}

async function receiveWithQr(value) {
    stopCamera();
    try {
        const { transferId, secret } = parseSecureLink(value);
        history.replaceState(null, '', `${location.pathname}${location.search}`);
        setMessage(receiveStatus, 'Retrieving encrypted transfer...');
        const manifest = await request(`/transfers/${transferId}/manifest`);
        const rawKey = decodeBase64Url(secret);
        if (rawKey.byteLength !== 32) throw new Error('QR code contains an invalid decryption key.');
        const fileKey = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);
        await receiveTransfer(manifest, fileKey);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not read the QR code.';
        const displayMessage = message === 'Transfer has expired'
            ? 'This transfer has expired. Please ask the sender to upload the files again.'
            : message === 'Transfer not found'
                ? 'This transfer is no longer available.'
                : message;
        setMessage(receiveStatus, displayMessage, true);
    }
}

async function openCamera() {
    const panel = document.getElementById('camera-panel');
    const video = document.getElementById('camera-video');
    panel.classList.remove('hidden');
    try {
        const reader = new BrowserQRCodeReader();
        cameraControls = await reader.decodeFromVideoDevice(undefined, video, result => {
            if (result) void receiveWithQr(result.getText());
        });
        setMessage(document.getElementById('camera-status'), 'Camera is open. Point it at a SecureShare QR code.');
    } catch (error) {
        const message = error instanceof Error && error.name === 'NotAllowedError'
            ? 'Camera permission was denied. Allow camera access or enter the six-digit code instead.'
            : error instanceof Error && error.name === 'NotFoundError'
                ? 'No camera was detected. Connect a camera or enter the six-digit code instead.'
                : 'Camera scanning is unavailable in this browser or page context. Use HTTPS or localhost, or enter the code.';
        setMessage(document.getElementById('camera-status'), message, true);
    }
}

function stopCamera() {
    cameraControls?.stop();
    cameraControls = undefined;
    const video = document.getElementById('camera-video');
    if (video) video.srcObject = null;
}

function createCodeInputs() {
    const container = document.getElementById('code-boxes');
    container.replaceChildren();
    for (let index = 0; index < 6; index += 1) {
        const input = document.createElement('input');
        input.className = 'code-box';
        input.type = 'text';
        input.inputMode = 'numeric';
        input.autocomplete = index === 0 ? 'one-time-code' : 'off';
        input.maxLength = 1;
        input.pattern = '[0-9]';
        input.setAttribute('aria-label', `Transfer code digit ${index + 1}`);
        input.addEventListener('input', () => {
            input.value = input.value.replace(/\D/gu, '').slice(-1);
            if (input.value && index < 5) container.children[index + 1].focus();
        });
        input.addEventListener('keydown', event => {
            if (event.key === 'Backspace' && !input.value && index > 0) container.children[index - 1].focus();
            if (event.key === 'ArrowLeft' && index > 0) container.children[index - 1].focus();
            if (event.key === 'ArrowRight' && index < 5) container.children[index + 1].focus();
        });
        input.addEventListener('paste', event => {
            const pasted = event.clipboardData?.getData('text')?.replace(/\D/gu, '').slice(0, 6);
            if (!pasted) return;
            event.preventDefault();
            [...pasted].forEach((digit, digitIndex) => { container.children[digitIndex].value = digit; });
            container.children[Math.min(pasted.length, 5)].focus();
        });
        container.append(input);
    }
}

async function copyText(value, label) {
    try {
        await navigator.clipboard.writeText(value);
        setMessage(uploadStatus, `${label} copied.`);
    } catch {
        setMessage(uploadStatus, 'Clipboard access is unavailable in this browser.', true);
    }
}

fileInput.addEventListener('change', () => {
    addFiles(fileInput.files);
    fileInput.value = '';
});
dropZone.addEventListener('dragover', event => {
    event.preventDefault();
    dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', event => {
    if (!dropZone.contains(event.relatedTarget)) dropZone.classList.remove('dragover');
});
dropZone.addEventListener('drop', event => {
    event.preventDefault();
    dropZone.classList.remove('dragover');
    addFiles(event.dataTransfer.files);
});
document.getElementById('remove-all').addEventListener('click', () => {
    selectedFiles.length = 0;
    setMessage(uploadStatus, '');
    renderSelectedFiles();
});
uploadButton.addEventListener('click', () => void beginUpload());
document.getElementById('code-btn').addEventListener('click', () => void receiveWithCode());
document.getElementById('qr-btn').addEventListener('click', () => void openCamera());
document.getElementById('stop-camera').addEventListener('click', stopCamera);
document.getElementById('copy-code').addEventListener('click', () => copyText(currentTransfer?.code ?? '', 'Transfer code'));
document.getElementById('copy-link').addEventListener('click', () => copyText(currentTransfer?.shareUrl ?? '', 'Secure link'));
document.getElementById('download-qr').addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = 'secureshare-qr.png';
    link.href = document.getElementById('qr-canvas').toDataURL('image/png');
    link.click();
});
document.getElementById('share-transfer').addEventListener('click', async () => {
    if (!currentTransfer) return;
    try {
        if (navigator.share) await navigator.share({ title: 'SecureShare transfer', text: `Code: ${currentTransfer.code}`, url: currentTransfer.shareUrl });
        else await copyText(currentTransfer.shareUrl, 'Secure link');
    } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setMessage(uploadStatus, 'Sharing was unavailable.', true);
    }
});
document.getElementById('delete-transfer').addEventListener('click', async () => {
    if (!currentTransfer || !confirm('Delete this transfer and its encrypted files?')) return;
    try {
        await request(`/transfers/${currentTransfer.transferId}`, {
            method: 'DELETE',
            headers: { 'X-Owner-Token': currentTransfer.ownerToken },
        });
        transferModal.classList.add('hidden');
        setMessage(uploadStatus, 'Transfer deleted.');
        currentTransfer = undefined;
        uploadButton.disabled = selectedFiles.length === 0;
    } catch (error) {
        setMessage(uploadStatus, error instanceof Error ? error.message : 'Could not delete the transfer.', true);
    }
});
document.getElementById('upload-another').addEventListener('click', () => {
    transferModal.classList.add('hidden');
    currentTransfer = undefined;
    selectedFiles.length = 0;
    renderSelectedFiles();
});

document.querySelectorAll('input[name="duration-days"]').forEach(input => {
    input.addEventListener('change', () => {
        document.querySelectorAll('.duration-option').forEach(option => option.classList.remove('selected'));
        input.closest('.duration-option').classList.add('selected');
    });
});

createCodeInputs();
renderSelectedFiles();

const directTransferRoute = location.pathname.match(/^\/receive\/([0-9a-f-]{36})\/?$/iu);
const legacyTransferLink = location.hash && new URLSearchParams(location.hash.slice(1)).has('id');
if (directTransferRoute || legacyTransferLink) {
    document.body.classList.add('direct-receive');
    document.title = 'Receive Files - SecureShare';
    document.getElementById('page-heading').textContent = 'Secure file transfer';
    document.getElementById('page-description').textContent = 'Validating this transfer and preparing your files.';
    void receiveWithQr(location.href);
}