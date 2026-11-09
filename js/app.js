// File upload drag and drop
const dropZone = document.getElementById('drop-zone');
const fileUpload = document.getElementById('file-upload');
const uploadBtn = document.getElementById('upload-btn');
const fileList = document.getElementById('file-list');
const totalSize = document.getElementById('total-size');
const uploadInfo = document.getElementById('upload-info');
const removeAll = document.getElementById('remove-all');
let selectedFiles = [];

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    fileUpload.files = e.dataTransfer.files;
    handleFiles(fileUpload.files);
});

fileUpload.addEventListener('change', () => {
    handleFiles(fileUpload.files);
});

function handleFiles(files) {
    selectedFiles = [];
    const maxSize = 50 * 1024 * 1024; // 50 MB
    const allowedTypes = [
        'application/pdf', 'application/msword',
        'application/vnd.openxmlformats-officedocument.word-processingml.document',
        'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/csv', 'text/plain', 'image/jpeg', 'image/png', 'image/webp',
        'application/zip', 'application/x-rar-compressed',
        'video/mp4', 'audio/mpeg'
    ];
    
    let total = 0;
    const validFiles = [];
    
    for (const file of files) {
        const isTypeAllowed = allowedTypes.includes(file.type) || file.type === '';
        const isUnderLimit = file.size <= maxSize;
        
        if (isTypeAllowed && isUnderLimit) {
            selectedFiles.push(file);
            total += file.size;
            validFiles.push(file);
        }
    }
    
    displayFiles(validFiles);
    updateTotalSize(total);
    uploadBtn.disabled = selectedFiles.length === 0;
}

function displayFiles(files) {
    fileList.innerHTML = '';
    files.forEach((file, index) => {
        const li = document.createElement('div');
        li.className = 'file-item';
        li.innerHTML = `<span class="file-name">${file.name}</span><span class="file-size">${formatSize(file.size)}</span><button type="button" class="btn-remove" onclick="removeFile(${index})">Remove</button>`;
        fileList.appendChild(li);
    });
    
    if (files.length > 0) {
        uploadInfo.style.display = 'block';
        removeAll.style.display = 'block';
    } else {
        uploadInfo.style.display = 'none';
        removeAll.style.display = 'none';
    }
}

function updateTotalSize(size) {
    const mb = (size / (1024 * 1024)).toFixed(2);
    totalSize.textContent = mb;
    uploadBtn.disabled = selectedFiles.length === 0 || total > 50 * 1024 * 1024;
}

function formatSize(bytes) {
    if (bytes >= 1024 * 1024) {
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    } else if (bytes >= 1024) {
        return (bytes / 1024).toFixed(1) + ' KB';
    }
    return bytes + ' bytes';
}

function removeFile(index) {
    selectedFiles.splice(index, 1);
    const remaining = selectedFiles.map(f => f.name);
    displayFiles(selectedFiles);
    updateTotalSize(selectedFiles.reduce((sum, f) => sum + f.size, 0));
    if (selectedFiles.length === 0) {
        uploadInfo.style.display = 'none';
        removeAll.style.display = 'none';
        uploadBtn.disabled = true;
    }
}

removeAll.addEventListener('click', () => {
    selectedFiles = [];
    fileUpload.value = '';
    displayFiles([]);
    updateTotalSize(0);
    uploadBtn.disabled = true;
});

uploadBtn.addEventListener('click', () => {
    if (selectedFiles.length === 0) {
        alert('Please select files to upload.');
        return;
    }
    
    // Validate total size
    const totalSizeMB = selectedFiles.reduce((sum, file) => sum + file.size, 0) / (1024 * 1024);
    if (totalSizeMB > 50) {
        alert('File exceeds maximum size limit of 50 MB.');
        return;
    }
    
    // Disable button and show loading state
    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Uploading...';
    
    // Create FormData for file upload
    const formData = new FormData();
    selectedFiles.forEach(file => {
        formData.append('files', file);
    });
    
    // Show progress indicator
    const progressContainer = document.createElement('div');
    progressContainer.className = 'upload-progress';
    progressContainer.innerHTML = `
        <div class="progress-bar">
            <div class="progress-fill" style="width: 0%"></div>
        </div>
        <span class="progress-text">0%</span>
    </div>;
    uploadInfo.insertBefore(progressContainer, removeAll);
    
    // Upload files to backend
    fetch('/api/upload', {
        method: 'POST',
        body: formData,
        headers: {
            // 'Authorization': `Bearer ${getAuthToken()}` // Uncomment when auth is implemented
        }
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('Upload failed');
        }
        return response.json();
    })
    .then(data => {
        // Upload successful - generate transfer
        generateTransfer(data);
    })
    .catch(error => {
        // Handle upload error
        uploadBtn.disabled = false;
        uploadBtn.textContent = 'Upload & Generate Code';
        const progressContainer = document.querySelector('.upload-progress');
        if (progressContainer) progressContainer.remove();
        alert('Upload failed: ' + error.message);
    });
});

// Helper: Get auth token if available
function getAuthToken() {
    // Return token from localStorage or cookie if auth is implemented
    // return localStorage.getItem('auth_token');
    return '';
}

uploadBtn.addEventListener('click', () => {
    if (selectedFiles.length === 0) return;
    
    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Uploading...';
    
    const formData = new FormData();
    selectedFiles.forEach(file => {
        formData.append('files', file);
    });
    
    setTimeout(() => {
        generateTransfer();
    }, 1500);
});

function formatSize(bytes) {
    if (bytes >= 1024 * 1024) {
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    } else if (bytes >= 1024) {
        return (bytes / 1024).toFixed(1) + ' KB';
    }
    return bytes + ' bytes';
}

function generateTransfer() {
    const transferCode = Math.floor(100000 + Math.random() * 899999);
    const transferId = 'SEC-' + Math.random().toString(36).substr(2, 9).toUpperCase();
    
    displayCompletedPage(selectedFiles, transferCode);
    
    document.getElementById('send-card').style.display = 'none';
    document.getElementById('receive-card').style.display = 'none';
    document.getElementById('transfer-completed').classList.remove('hidden');
}

function displayCompletedPage(files, transferCode) {
    const fileListContainer = document.getElementById('file-list-completed');
    const totalSizeEl = document.getElementById('total-size-completed');
    const expirationEl = document.getElementById('expiration-time');
    
    fileListContainer.innerHTML = '';
    let total = 0;
    
    files.forEach(file => {
        total += file.size;
        const div = document.createElement('div');
        div.className = 'file-item';
        div.innerHTML = `<span>${file.name}</span><span>${formatSize(file.size)}</span>`;
        fileListContainer.appendChild(div);
    });
    
    totalSizeEl.textContent = (total / (1024 * 1024)).toFixed(1) + ' MB';
    
    const now = new Date();
    const expiry = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    expirationEl.textContent = `${expiry.toLocaleDateString()} ${expiry.toLocaleTimeString()}`;
    
    document.getElementById('transfer-code').textContent = transferCode;
    
    generateQRCode(`https://secureshare.com/transfer/${transferCode}`);
}

function generateTransfer() {
    const transferCode = Math.floor(100000 + Math.random() * 899999);
    const transferId = 'SEC-' + Math.random().toString(36).substr(2, 9).toUpperCase();
    
    displayCompletedPage(selectedFiles, transferCode);
    
    document.getElementById('send-card').style.display = 'none';
    document.getElementById('receive-card').style.display = 'none';
    document.getElementById('transfer-completed').classList.remove('hidden');
}

function displayCompletedPage(files, transferCode) {
    const fileListContainer = document.getElementById('file-list-completed');
    const totalSizeEl = document.getElementById('total-size-completed');
    const expirationEl = document.getElementById('expiration-time');
    
    fileListContainer.innerHTML = '';
    let total = 0;
    
    files.forEach(file => {
        total += file.size;
        const div = document.createElement('div');
        div.className = 'file-item';
        div.innerHTML = `<span>${file.name}</span><span>${formatSize(file.size)}</span>`;
        fileListContainer.appendChild(div);
    });
    
    totalSizeEl.textContent = (total / (1024 * 1024)).toFixed(1) + ' MB';
    
    const now = new Date();
    const expiry = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    expirationEl.textContent = `${expiry.toLocaleDateString()} ${expiry.toLocaleTimeString()}`;
    
    document.getElementById('transfer-code').textContent = transferCode;
    
    generateQRCode(`https://secureshare.com/transfer/${transferCode}`);
}

function generateQRCode(url) {
    const canvas = document.getElementById('qr-canvas');
    const qrContext = canvas.getContext('2d');
    
    qrContext.clearRect(0, 0, canvas.width, canvas.height);
    const size = 150;
    qrContext.fillStyle = '#ffffff';
    qrContext.fillRect(0, 0, canvas.width, canvas.height);
    qrContext.fillStyle = '#3b82f6';
    
    const moduleSize = size / 21;
    for (let row = 0; row < 21; row++) {
        for (let col = 0; col < 21; col++) {
            if (row === 0 || row === 20 || col === 0 || col === 20 || 
                (row > 6 && row < 14 && col > 6 && col < 14)) {
                qrContext.fillRect(
                    col * moduleSize + 1,
                    row * moduleSize + 1,
                    moduleSize - 2,
                    moduleSize - 2
                );
            }
        }
    }
}

function copyCode() {
    const code = document.getElementById('transfer-code').textContent;
    navigator.clipboard.writeText(code).then(() => {
        alert('Code copied to clipboard!');
    });
}

function copyLink() {
    const link = window.location.origin + '/transfer/secure';
    navigator.clipboard.writeText(link).then(() => {
        alert('Link copied to clipboard!');
    });
}

function downloadQR() {
    const canvas = document.getElementById('qr-canvas');
    const link = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = link;
    a.download = 'qr-code.png';
    a.click();
}

function generateQRCode(url) {
    const canvas = document.getElementById('qr-canvas');
    const qrContext = canvas.getContext('2d');
    
    qrContext.clearRect(0, 0, canvas.width, canvas.height);
    const size = 150;
    qrContext.fillStyle = '#ffffff';
    qrContext.fillRect(0, 0, canvas.width, canvas.height);
    qrContext.fillStyle = '#3b82f6';
    
    const moduleSize = size / 21;
    for (let row = 0; row < 21; row++) {
        for (let col = 0; col < 21; col++) {
            if (row === 0 || row === 20 || col === 0 || col === 20 || 
                (row > 6 && row < 14 && col > 6 && col < 14)) {
                qrContext.fillRect(
                    col * moduleSize + 1,
                    row * moduleSize + 1,
                    moduleSize - 2,
                    moduleSize - 2
                );
            }
        }
    }
}

function copyCode() {
    const code = document.getElementById('transfer-code').textContent;
    navigator.clipboard.writeText(code).then(() => {
        alert('Code copied to clipboard!');
    });
}

function copyLink() {
    const link = window.location.origin + '/transfer/secure';
    navigator.clipboard.writeText(link).then(() => {
        alert('Link copied to clipboard!');
    });
}

function downloadQR() {
    const canvas = document.getElementById('qr-canvas');
    const link = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = link;
    a.download = 'qr-code.png';
    a.click();
}

function shareTransfer() {
    if (navigator.share) {
        navigator.share({
            title: 'SecureShare Transfer',
            text: 'Your files are ready to share!',
        }).then(() => {
            // Handle successful share
        }).catch((error) => {
            console.error('Share failed', error);
        });
    } else {
        alert('Share API not supported on this device');
    }
}

function deleteTransfer() {
    if (confirm('Are you sure you want to delete this transfer?')) {
        document.getElementById('transfer-completed').classList.add('hidden');
        showUploadCards();
    }
}

function showUploadCards() {
    document.getElementById('send-card').style.display = 'block';
    document.getElementById('receive-card').style.display = 'block';
    document.getElementById('transfer-completed').classList.add('hidden');
}

// 6-Digit Code Entry
function initCodeBoxes() {
    const codeBoxes = document.getElementById('code-boxes');
    codeBoxes.innerHTML = '';
    for (let i = 0; i < 6; i++) {
        const box = document.createElement('div');
        box.className = 'code-box';
        box.oninput = function() {
            if (this.value.length > 1) {
                this.value = this.value.charAt(0);
            }
            if (this.value.length === 1 && i < 5) {
                const nextBox = codeBoxes.children[i + 1];
                if (nextBox) nextBox.focus();
            }
        };
        codeBoxes.appendChild(box);
    }
}

initCodeBoxes();

// QR Code Scanner (mock)
const qrBtn = document.getElementById('qr-btn');
qrBtn.addEventListener('click', () => {
    alert('QR Code scanner would open camera. In a real implementation, this would use the Web Camera API.');
});

// Code receive button
const codeBtn = document.getElementById('code-btn');
codeBtn.addEventListener('click', () => {
    const codeBoxes = document.getElementById('code-boxes');
    const codeValues = Array.from(codeBoxes.children).map(box => box.value).join('');
    
    if (codeValues.length === 6) {
        verifyCode(codeValues);
    } else {
        alert('Please enter a complete 6-digit code');
    }
});

function verifyCode(code) {
    // In a real implementation, verify the code against the server
    // For now, show the transfer completed page
    document.getElementById('receive-card').style.display = 'none';
    document.getElementById('transfer-completed').classList.remove('hidden');
    displayCompletedPage([], code);
}