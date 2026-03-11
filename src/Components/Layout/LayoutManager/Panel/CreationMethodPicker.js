import { FontAwesomeIcon, Heading } from "@trops/dash-react";

const OptionCard = ({ icon, title, description, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="w-full flex flex-row items-center gap-4 p-4 rounded-lg text-left transition-all bg-gray-700/50 hover:bg-gray-700 hover:ring-1 hover:ring-gray-600"
  >
    <div className="flex-shrink-0 h-8 w-8 flex items-center justify-center text-gray-400">
      <FontAwesomeIcon icon={icon} className="h-5 w-5" />
    </div>
    <div className="flex flex-col min-w-0">
      <span className="text-sm font-medium text-gray-200">{title}</span>
      <span className="text-xs text-gray-500 mt-0.5">{description}</span>
    </div>
    <div className="flex-shrink-0 ml-auto text-gray-600">
      <FontAwesomeIcon icon="chevron-right" className="h-3 w-3" />
    </div>
  </button>
);

export const CreationMethodPicker = ({ onSelect }) => {
  return (
    <div className="flex flex-row w-full h-full">
      {/* Left 1/3 — Info sidebar */}
      <div className="flex flex-col w-1/3 p-6 py-10 space-y-4 justify-start">
        <Heading
          title="New Dashboard"
          padding={false}
          textColor="text-gray-300"
        />
        <p className="text-base font-normal text-gray-400">
          Choose how you'd like to create your new dashboard.
        </p>
      </div>
      {/* Right 2/3 — Option cards */}
      <div className="flex flex-col w-2/3 p-6 pt-10 space-y-3">
        <OptionCard
          icon="plus"
          title="New Dashboard"
          description="Start from a blank template and customize your layout"
          onClick={() => onSelect("template")}
        />
        <OptionCard
          icon="file-zipper"
          title="Import from File"
          description="Import a dashboard from a .zip file on your computer"
          onClick={() => onSelect("import")}
        />
        <OptionCard
          icon="compass"
          title="Search Registry"
          description="Browse and install dashboards from the online registry"
          onClick={() => onSelect("registry")}
        />
      </div>
    </div>
  );
};
