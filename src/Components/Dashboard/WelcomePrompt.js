import React from "react";
import {
  Modal,
  SubHeading2,
  Paragraph2,
  Button,
  Button2,
  FontAwesomeIcon,
} from "@trops/dash-react";

const WELCOME_STORAGE_KEY = "dash:welcome-prompted";

function markPrompted() {
  localStorage.setItem(WELCOME_STORAGE_KEY, "true");
}

const WelcomePrompt = ({ isOpen, onAccept, onDismiss }) => {
  const handleAccept = () => {
    markPrompted();
    if (onAccept) onAccept();
  };

  const handleDismiss = () => {
    markPrompted();
    if (onDismiss) onDismiss();
  };

  return (
    <Modal
      isOpen={isOpen}
      setIsOpen={handleDismiss}
      width="w-[520px]"
      height="h-auto"
    >
      <div className="px-8 pt-8 pb-4 flex flex-col items-center text-center gap-4">
        <div className="text-4xl opacity-60">
          <FontAwesomeIcon icon="table-cells-large" />
        </div>
        <SubHeading2>Welcome to Dash!</SubHeading2>
        <Paragraph2 className="max-w-sm">
          Get started with a sample dashboard that showcases widgets for AI
          chat, notes, GitHub, Slack, Gmail, Calendar, and more — all in a
          ready-made 4x3 grid.
        </Paragraph2>
      </div>
      <Modal.Footer>
        <div className="flex flex-row gap-3 w-full justify-end">
          <Button2 title="Start Fresh" onClick={handleDismiss} />
          <Button title="Load Sample Dashboard" onClick={handleAccept} />
        </div>
      </Modal.Footer>
    </Modal>
  );
};

export { WelcomePrompt, WELCOME_STORAGE_KEY };
