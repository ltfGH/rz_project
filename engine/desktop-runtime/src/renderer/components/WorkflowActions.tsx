import type { AllowedTransitionDto } from '../../shared/dto';

export function WorkflowActions({ actions, onExecute }: {
  actions: readonly AllowedTransitionDto[];
  onExecute(action: AllowedTransitionDto): void;
}) {
  return <div className="workflow-actions">{actions.map((action) => (
    <button key={action.transitionId} className="primary-button" onClick={() => onExecute(action)}>{action.name}</button>
  ))}</div>;
}
