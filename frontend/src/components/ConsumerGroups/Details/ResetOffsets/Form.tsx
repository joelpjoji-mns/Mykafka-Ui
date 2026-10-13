import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ConsumerGroupDetails,
  ConsumerGroupOffsetsReset,
  ConsumerGroupOffsetsResetType,
} from 'generated-sources';
import { ClusterGroupParam } from 'lib/paths';
import {
  Controller,
  FormProvider,
  useFieldArray,
  useForm,
} from 'react-hook-form';
import { Option } from 'react-multi-select-component';
import MultiSelect from 'components/common/MultiSelect/MultiSelect.styled';
import 'react-datepicker/dist/react-datepicker.css';
import { ErrorMessage } from '@hookform/error-message';
import { InputLabel } from 'components/common/Input/InputLabel.styled';
import { Button } from 'components/common/Button/Button';
import { Modal } from 'components/common/Modal';
import Checkbox from 'components/common/Checkbox/Checkbox';
import Input from 'components/common/Input/Input';
import { FormError } from 'components/common/Input/Input.styled';
import useAppParams from 'lib/hooks/useAppParams';
import { useResetConsumerGroupOffsetsMutation } from 'lib/hooks/api/consumers';
import { FlexFieldset, StyledForm } from 'components/common/Form/Form.styled';
import ControlledSelect from 'components/common/Select/ControlledSelect';
import { useTimezone } from 'lib/hooks/useTimezones';

import * as S from './ResetOffsets.styled';

interface FormProps {
  defaultValues: ConsumerGroupOffsetsReset;
  topics: string[];
  partitions: ConsumerGroupDetails['partitions'];
}

const resetTypeOptions = Object.values(ConsumerGroupOffsetsResetType).map(
  (value) => ({ value, label: value })
);

const Form: React.FC<FormProps> = ({ defaultValues, partitions, topics }) => {
  const navigate = useNavigate();
  const { getDateInCurrentTimezone } = useTimezone();
  const routerParams = useAppParams<ClusterGroupParam>();
  const reset = useResetConsumerGroupOffsetsMutation(routerParams);
  const topicOptions = React.useMemo(
    () => topics.map((value) => ({ value, label: value })),
    [topics]
  );
  const methods = useForm<ConsumerGroupOffsetsReset>({
    mode: 'onChange',
    defaultValues,
  });

  const {
    handleSubmit,
    setValue,
    watch,
    control,
    formState: { errors },
  } = methods;
  const { fields } = useFieldArray({
    control,
    name: 'partitionsOffsets',
  });

  const resetTypeValue = watch('resetType');
  const topicValue = watch('topic');
  const offsetsValue = watch('partitionsOffsets');
  const partitionsValue = watch('partitions') || [];

  const partitionOptions =
    partitions
      ?.filter((p) => p.topic === topicValue)
      .map((p) => ({
        label: `Partition #${p.partition.toString()}`,
        value: p.partition,
      })) || [];

  const onSelectedPartitionsChange = (selected: Option[]) => {
    setValue(
      'partitions',
      selected.map(({ value }) => value)
    );

    setValue(
      'partitionsOffsets',
      selected.map(({ value }) => {
        const currentOffset = offsetsValue?.find(
          ({ partition }) => partition === value
        );
        return { offset: currentOffset?.offset, partition: value };
      })
    );
  };

  React.useEffect(() => {
    onSelectedPartitionsChange([]);
  }, [topicValue]);

  const onSubmit = async (data: ConsumerGroupOffsetsReset) => {
    const completed = await reset.mutateAsync(data);
    if (completed === false) return;
    navigate(-1);
  };

  return (
    <FormProvider {...methods}>
      <StyledForm onSubmit={handleSubmit(onSubmit)}>
        <FlexFieldset>
          <ControlledSelect
            name="topic"
            label="Topic"
            placeholder="Select Topic"
            options={topicOptions}
          />
          <ControlledSelect
            name="resetType"
            label="Reset Type"
            placeholder="Select Reset Type"
            options={resetTypeOptions}
          />
          <Checkbox
            name="waitForInactive"
            label="Wait for an active consumer group to become inactive"
            hint="Waits until the group is inactive or you cancel. Never pauses or removes consumers."
          />
          <div>
            <InputLabel>Partitions</InputLabel>
            <MultiSelect
              options={partitionOptions}
              value={partitionsValue.map((p) => ({
                value: p,
                label: String(p),
              }))}
              onChange={onSelectedPartitionsChange}
              labelledBy="Select partitions"
            />
          </div>
          {resetTypeValue === ConsumerGroupOffsetsResetType.TIMESTAMP &&
            partitionsValue.length > 0 && (
              <div>
                <InputLabel>Timestamp</InputLabel>
                <Controller
                  control={control}
                  name="resetToTimestamp"
                  rules={{
                    required: 'Timestamp is required',
                  }}
                  render={({ field: { onChange, onBlur, value } }) => (
                    <S.DatePickerInput
                      showTimeInput
                      timeInputLabel="Time:"
                      dateFormat="MMMM d, yyyy h:mm aa"
                      selected={getDateInCurrentTimezone(
                        new Date(value as number)
                      )}
                      onChange={(selectedDate: Date | null) => {
                        onChange(selectedDate?.getTime());
                      }}
                      onBlur={onBlur}
                    />
                  )}
                />
                <ErrorMessage
                  errors={errors}
                  name="resetToTimestamp"
                  render={({ message }) => <FormError>{message}</FormError>}
                />
              </div>
            )}

          {resetTypeValue === ConsumerGroupOffsetsResetType.OFFSET &&
            partitionsValue.length > 0 && (
              <S.OffsetsWrapper>
                {fields.map((field, index) => (
                  <Input
                    key={field.id}
                    label={`Partition #${field.partition} Offset`}
                    type="number"
                    name={`partitionsOffsets.${index}.offset` as const}
                    hookFormOptions={{
                      shouldUnregister: true,
                      required: 'Offset is required',
                      min: {
                        value: 0,
                        message: 'must be greater than or equal to 0',
                      },
                    }}
                    withError
                  />
                ))}
              </S.OffsetsWrapper>
            )}
        </FlexFieldset>
        <div>
          <Button
            buttonSize="M"
            buttonType="primary"
            type="submit"
            disabled={partitionsValue.length === 0 || reset.isPending}
          >
            Reset Offsets
          </Button>
        </div>
      </StyledForm>
      <Modal
        isOpen={reset.isPending}
        onClose={() => reset.cancel()}
        title="Waiting to reset consumer offsets"
        footer={
          <Button
            buttonType="secondary"
            buttonSize="M"
            onClick={() => reset.cancel()}
          >
            Cancel waiting
          </Button>
        }
      >
        <p>
          The reset waits until the consumer group is inactive, with no time
          limit. You can cancel the pending request. Consumers are never paused
          or removed.
        </p>
        <p>
          Cancellation stops waiting; it cannot undo offsets already changed if
          the group became inactive at the same moment.
        </p>
      </Modal>
    </FormProvider>
  );
};

export default Form;
