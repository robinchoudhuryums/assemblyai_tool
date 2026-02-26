import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
// --- THIS LINE IS THE FIX ---
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudUpload, FileAudio, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import type { Employee } from "@shared/schema";

interface UploadFile {
  file: File;
  employeeId: string;
  progress: number;
  status: 'pending' | 'uploading' | 'processing' | 'completed' | 'error';
  error?: string;
}

export default function FileUpload() {
  const [uploadFiles, setUploadFiles] = useState<UploadFile[]>([]);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: employees } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ file, employeeId }: { file: File; employeeId?: string }) => {
      const formData = new FormData();
      formData.append('audioFile', file);
      if (employeeId) formData.append('employeeId', employeeId);
      
      const response = await fetch('/api/calls/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Upload failed');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/calls"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/metrics"] });
      toast({ title: "Upload Successful", description: "Your file is now being processed." });
    },
    onError: (error) => {
      toast({ title: "Upload Failed", description: error.message, variant: "destructive" });
    },
  });

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const newFiles = acceptedFiles.map(file => ({
      file, employeeId: '', progress: 0, status: 'pending' as const,
    }));
    setUploadFiles(prev => [...prev, ...newFiles]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'audio/*': ['.mp3', '.wav', '.m4a'] },
    maxSize: 500 * 1024 * 1024,
  });

  const updateFile = (index: number, updates: Partial<UploadFile>) => {
    setUploadFiles(prev => prev.map((file, i) => i === index ? { ...file, ...updates } : file));
  };

  const removeFile = (index: number) => {
    setUploadFiles(prev => prev.filter((_, i) => i !== index));
  };

  const uploadFile = async (index: number) => {
    const fileData = uploadFiles[index];
    try {
      updateFile(index, { status: 'uploading', progress: 0 });
      await uploadMutation.mutateAsync({ file: fileData.file, employeeId: fileData.employeeId || undefined });
      updateFile(index, { status: 'completed', progress: 100 });
      setTimeout(() => removeFile(index), 3000);
    } catch (error) {
      updateFile(index, { status: 'error', error: error instanceof Error ? error.message : 'Upload failed' });
    }
  };

  const uploadAll = () => {
    uploadFiles.forEach((file, index) => {
      if (file.status === 'pending') {
        uploadFile(index);
      }
    });
  };

  return (
    <div className="bg-card rounded-lg border border-border p-6">
      <h3 className="text-lg font-semibold text-foreground mb-4">Upload Call Recordings</h3>
      <div {...getRootProps()} className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer`}>
        <input {...getInputProps()} />
        <CloudUpload className="mx-auto h-12 w-12 text-gray-400" />
        <p className="mt-2 text-sm text-gray-600">Drag & drop files here, or click to select files</p>
      </div>
      
      {uploadFiles.length > 0 && (
        <div className="mt-6 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-foreground">Files to Upload</h4>
            <Button type="button" onClick={uploadAll} disabled={uploadMutation.isPending}>
              Upload All
            </Button>
          </div>
          {uploadFiles.map((fileData, index) => (
            <div key={index} className="flex items-center space-x-4 p-4 bg-muted rounded-lg">
              <FileAudio className="text-primary w-8 h-8" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{fileData.file.name}</p>
                {/* Progress bar and status logic can go here */}
              </div>
              <Select onValueChange={(value) => updateFile(index, { employeeId: value })}>
                <SelectTrigger className="w-48"><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>
                  {employees?.map(employee => (
                    <SelectItem key={employee.id} value={employee.id}>{employee.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="ghost" onClick={() => removeFile(index)}><X className="w-4 h-4" /></Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

