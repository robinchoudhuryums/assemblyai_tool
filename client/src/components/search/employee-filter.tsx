import { useQuery } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { User } from "@phosphor-icons/react";
import type { Employee } from "@shared/schema";

interface EmployeeFilterProps {
  value: string;
  onChange: (value: string) => void;
}

export function EmployeeFilter({ value, onChange }: EmployeeFilterProps) {
  const { data: employees } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <User className="w-4 h-4 mr-2" />
        <SelectValue placeholder="All Employees" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All Employees</SelectItem>
        {/* This safety filter is critical */}
        {employees
          ?.filter(e => e && e.id && e.name)
          .map((employee) => (
            <SelectItem key={employee.id} value={employee.id}>
              {employee.name}
            </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
