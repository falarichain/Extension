import { useEffect, useState } from 'react';
import { Shield, Check, X, AlertTriangle } from 'lucide-react';

interface SignRequest {
  address: string;
  hash: string;
  origin: string;
  createdAt: number;
}

export default function ApprovalPage() {
  const [requestId, setRequestId] = useState<string | null>(null);
  const [request, setRequest] = useState<SignRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('requestId');
    if (!id) {
      setError('No request ID provided');
      setLoading(false);
      return;
    }
    setRequestId(id);

    chrome.storage.session.get(`dapp_sign_${id}`, (result) => {
      const data = result[`dapp_sign_${id}`];
      if (!data) {
        setError('Signing request not found or expired');
        setLoading(false);
        return;
      }
      setRequest(data as SignRequest);
      setLoading(false);
    });
  }, []);

  const handleApprove = () => {
    if (!requestId) return;
    setProcessing(true);
    chrome.runtime.sendMessage(
      { type: 'DAPP_APPROVAL_RESULT', requestId, approved: true },
      () => {
        window.close();
      },
    );
  };

  const handleReject = () => {
    if (!requestId) return;
    setProcessing(true);
    chrome.runtime.sendMessage(
      { type: 'DAPP_APPROVAL_RESULT', requestId, approved: false },
      () => {
        window.close();
      },
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500 text-sm">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
        <AlertTriangle className="w-10 h-10 text-red-500 mb-3" />
        <p className="text-red-600 text-sm text-center">{error}</p>
      </div>
    );
  }

  if (!request) return null;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-5 py-4">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-primary-600" />
          <h1 className="text-base font-bold text-primary-700">Sign Request</h1>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-5 space-y-4">
        {/* Origin */}
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
          <p className="text-xs text-yellow-600 font-medium mb-1">Request Origin</p>
          <p className="text-sm text-yellow-800 font-mono break-all">{request.origin}</p>
        </div>

        {/* Details */}
        <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
          <div className="px-4 py-3">
            <p className="text-xs text-gray-500 mb-1">Signing Address</p>
            <p className="text-sm font-mono text-gray-900 break-all">{request.address}</p>
          </div>
          <div className="px-4 py-3">
            <p className="text-xs text-gray-500 mb-1">Hash</p>
            <p className="text-sm font-mono text-gray-900 break-all">{request.hash}</p>
          </div>
        </div>

        <p className="text-xs text-gray-500 text-center">
          Review the details above carefully. Approving will sign this hash with your private key.
        </p>
      </div>

      {/* Actions */}
      <div className="px-5 pb-5 flex gap-3">
        <button
          onClick={handleReject}
          disabled={processing}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-300 disabled:opacity-50 transition-colors"
        >
          <X className="w-4 h-4" />
          Reject
        </button>
        <button
          onClick={handleApprove}
          disabled={processing}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
        >
          <Check className="w-4 h-4" />
          {processing ? 'Signing...' : 'Approve'}
        </button>
      </div>
    </div>
  );
}
