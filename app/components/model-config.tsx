import { ModalConfigValidator, ModelConfig } from "../store";

import Locale from "../locales";
import { InputRange } from "./input-range";
import { ListItem, Select } from "./ui-lib";
import { useAllModels } from "../utils/hooks";
import { getModelProvider } from "../utils/model";

export function ModelConfigList(props: {
  modelConfig: ModelConfig;
  updateConfig: (updater: (config: ModelConfig) => void) => void;
}) {
  const allModels = useAllModels();
  const availableModels = allModels.filter((v) => v.available);
  const value = props.modelConfig.model;

  return (
    <>
      <ListItem title={Locale.Settings.Model}>
        <Select
          aria-label={Locale.Settings.Model}
          value={value}
          align="left"
          onChange={(e) => {
            const [model] = getModelProvider(e.currentTarget.value);
            props.updateConfig((config) => {
              config.model = ModalConfigValidator.model(model);
            });
          }}
        >
          {availableModels.map((v, i) => (
            <option value={v.name} key={i}>
              {v.displayName}
            </option>
          ))}
        </Select>
      </ListItem>
      <ListItem
        title={Locale.Settings.Temperature.Title}
        subTitle={Locale.Settings.Temperature.SubTitle}
      >
        <InputRange
          aria={Locale.Settings.Temperature.Title}
          value={props.modelConfig.temperature?.toFixed(1)}
          min="0"
          max="1" // lets limit it to 0-1
          step="0.1"
          onChange={(e) => {
            props.updateConfig(
              (config) =>
                (config.temperature = ModalConfigValidator.temperature(
                  e.currentTarget.valueAsNumber,
                )),
            );
          }}
        ></InputRange>
      </ListItem>
      <ListItem
        title={Locale.Settings.MaxTokens.Title}
        subTitle={Locale.Settings.MaxTokens.SubTitle}
      >
        <input
          aria-label={Locale.Settings.MaxTokens.Title}
          type="number"
          min={1024}
          max={512000}
          value={props.modelConfig.max_tokens}
          onChange={(e) =>
            props.updateConfig(
              (config) =>
                (config.max_tokens = ModalConfigValidator.max_tokens(
                  e.currentTarget.valueAsNumber,
                )),
            )
          }
        ></input>
      </ListItem>

      <ListItem
        title={Locale.Settings.BudgetTokens.Title}
        subTitle={Locale.Settings.BudgetTokens.SubTitle}
      >
        <input
          aria-label={Locale.Settings.BudgetTokens.Title}
          type="number"
          min={1024}
          max={32000}
          value={props.modelConfig.budget_tokens}
          onChange={(e) =>
            props.updateConfig(
              (config) =>
                (config.budget_tokens = ModalConfigValidator.budget_tokens(
                  e.currentTarget.valueAsNumber,
                )),
            )
          }
        ></input>
      </ListItem>
    </>
  );
}
